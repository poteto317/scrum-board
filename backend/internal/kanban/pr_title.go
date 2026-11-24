package kanban

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	prTitleAPITimeout      = 2 * time.Second
	prTitleCacheTTL        = 10 * time.Minute
	prTitleCacheTTLFailure = time.Minute
	prTitleCacheMaxEntries = 512
	prTitleMaxConcurrent   = 8
	// A real title that cannot be refreshed (deleted PR, private repository) is dropped after this.
	prTitleStaleMaxAge = time.Hour
	prTitleUserAgent   = "scrum-board-kanban"
	githubPullAPIBase  = "https://api.github.com/repos/"
	// Shared cap: POST /api/pr-titles body size and attachPRTitles enrichment.
	maxPRTitleBatch = 50
)

func pullNumberFromPRURL(url string) (string, bool) {
	const prefix = "/pull/"
	i := strings.LastIndex(url, prefix)
	if i < 0 {
		return "", false
	}
	num := url[i+len(prefix):]
	if num == "" || num[0] == '0' {
		return "", false
	}
	for _, c := range num {
		if c < '0' || c > '9' {
			return "", false
		}
	}
	return num, true
}

// FallbackPRTitle returns owner/repo#n for a GitHub PR URL. Never returns the full URL.
func FallbackPRTitle(url string) string {
	if !validPRURL(url) {
		return "#"
	}
	parts := prURLPattern.FindStringSubmatch(url)
	if len(parts) != 3 {
		return "#"
	}
	owner, repo := parts[1], parts[2]
	num, ok := pullNumberFromPRURL(url)
	if !ok {
		return fmt.Sprintf("%s/%s#?", owner, repo)
	}
	return fmt.Sprintf("%s/%s#%s", owner, repo, num)
}

// PRTitleResolver fetches PR titles from the GitHub API with in-process caching.
//
//   - A cached label is served even after it expired, and refreshed in the background, so callers
//     (item polling) do not wait for GitHub; only a never-seen URL waits for its first answer.
//   - A failed refresh keeps the last real title for up to prTitleStaleMaxAge.
//   - Simultaneous requests for one URL share a single GitHub request (inflight); the GitHub
//     requests in progress are bounded by slots.
//
// mu guards cache and inflight.
type PRTitleResolver struct {
	client *http.Client
	token  string
	mu     sync.Mutex
	cache  map[string]cacheTitleEntry
	slots  chan struct{}
	now    func() time.Time
	// slotWait bounds the wait for one of the GitHub request slots.
	slotWait time.Duration
	// firstWait bounds how long a never-seen URL makes its caller wait for the first answer.
	firstWait time.Duration
	// inflight shares one GitHub request among everyone who wants the same URL at the same time.
	inflight map[string]*titleFlight
}

// titleFlight is one GitHub request in progress; label is valid once done is closed.
type titleFlight struct {
	done  chan struct{}
	label string
}

// closedChan is the done channel of a flight that has its answer already.
var closedChan = func() chan struct{} {
	c := make(chan struct{})
	close(c)
	return c
}()

type cacheTitleEntry struct {
	label  string
	expiry time.Time
	// ok marks a real title from GitHub (not the fallback), which a failed refresh must not replace.
	ok bool
	// okAt is when the title was last confirmed by GitHub (kept across failed refreshes).
	okAt time.Time
}

// NewPRTitleResolver builds a resolver. rt nil uses DefaultTransport.
// token empty falls back to GITHUB_TOKEN env (tests); production should pass getenv from wiring.
func NewPRTitleResolver(rt http.RoundTripper, token ...string) *PRTitleResolver {
	if rt == nil {
		rt = http.DefaultTransport
	}
	tok := ""
	if len(token) > 0 {
		tok = strings.TrimSpace(token[0])
	} else {
		tok = strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	}
	return &PRTitleResolver{
		client:    &http.Client{Timeout: prTitleAPITimeout, Transport: rt},
		token:     tok,
		cache:     make(map[string]cacheTitleEntry),
		slots:     make(chan struct{}, prTitleMaxConcurrent),
		now:       time.Now,
		slotWait:  2 * prTitleAPITimeout,
		firstWait: prTitleAPITimeout + prTitleAPITimeout/2,
		inflight:  make(map[string]*titleFlight),
	}
}

type githubPullResponse struct {
	Title string `json:"title"`
}

// Resolve returns the PR title or FallbackPRTitle; never empty for valid PR URLs.
//
// A cached label is returned at once, even after it has expired: an expired one is refreshed in
// the background, so polling never waits for GitHub (and a failing URL is asked about at most once
// per cache lifetime). Only a URL never seen before waits for its first answer, bounded by ctx and by firstWait.
func (r *PRTitleResolver) Resolve(ctx context.Context, prURL string) string {
	fallback := FallbackPRTitle(prURL)
	if !validPRURL(prURL) {
		return fallback
	}
	now := r.now()
	r.mu.Lock()
	e, cached := r.cache[prURL]
	r.mu.Unlock()
	if cached {
		if !now.Before(e.expiry) {
			r.startFetch(prURL, fallback)
		}
		return e.label
	}
	f := r.startFetch(prURL, fallback)
	timer := time.NewTimer(r.firstWait)
	defer timer.Stop()
	select {
	case <-f.done:
		return f.label
	case <-timer.C:
		return fallback
	case <-ctx.Done():
		return fallback
	}
}

// startFetch begins a GitHub request for prURL unless one is already in progress, and returns it
// (or, when a fresh answer is already cached, a finished flight carrying that answer).
// The request runs on its own context: the caller that started it may go away (the HTTP request
// ended), but the answer still fills the cache for the next one.
func (r *PRTitleResolver) startFetch(prURL, fallback string) *titleFlight {
	r.mu.Lock()
	if f, ok := r.inflight[prURL]; ok {
		r.mu.Unlock()
		return f
	}
	// An answer may have been stored between the caller's cache check and now.
	if e, ok := r.cache[prURL]; ok && r.now().Before(e.expiry) {
		r.mu.Unlock()
		return &titleFlight{done: closedChan, label: e.label}
	}
	f := &titleFlight{done: make(chan struct{})}
	r.inflight[prURL] = f
	r.mu.Unlock()
	go r.runFetch(prURL, fallback, f)
	return f
}

// fetchResult is what one GitHub request came to. attempted is false when it never reached GitHub
// (no request slot became free), which is not a GitHub failure and is not cached.
type fetchResult struct {
	label     string
	ok        bool
	attempted bool
}

// runFetch waits for a request slot, asks GitHub and stores the answer. Whatever happens (a panic
// included) the URL is released, so later callers are never stuck behind a dead request. When no
// slot becomes free, nothing is stored and the waiting callers get the fallback.
func (r *PRTitleResolver) runFetch(prURL, fallback string, f *titleFlight) {
	res := fetchResult{label: fallback}
	defer func() {
		if rec := recover(); rec != nil {
			res = fetchResult{label: fallback, attempted: res.attempted}
		}
		r.finishFetch(prURL, f, res)
	}()
	waitCtx, cancelWait := context.WithTimeout(context.Background(), r.slotWait)
	defer cancelWait()
	select {
	case r.slots <- struct{}{}:
	case <-waitCtx.Done():
		return
	}
	defer func() { <-r.slots }()
	res.attempted = true
	reqCtx, cancelReq := context.WithTimeout(context.Background(), prTitleAPITimeout)
	defer cancelReq()
	res.label, res.ok = r.fetch(reqCtx, prURL, res.label)
}

// nextCacheEntry decides what to cache after an attempted request: a title is cached for
// prTitleCacheTTL; a failure for prTitleCacheTTLFailure, keeping the previous real title
// (stale-if-error) unless GitHub has not confirmed it for prTitleStaleMaxAge.
func nextCacheEntry(prev cacheTitleEntry, hasPrev bool, res fetchResult, now time.Time) cacheTitleEntry {
	if res.ok {
		return cacheTitleEntry{label: res.label, ok: true, okAt: now, expiry: now.Add(prTitleCacheTTL)}
	}
	if hasPrev && prev.ok && now.Sub(prev.okAt) < prTitleStaleMaxAge {
		return cacheTitleEntry{label: prev.label, ok: true, okAt: prev.okAt, expiry: now.Add(prTitleCacheTTLFailure)}
	}
	return cacheTitleEntry{label: res.label, expiry: now.Add(prTitleCacheTTLFailure)}
}

// finishFetch stores the answer (unless it never reached GitHub) and wakes the callers waiting on f.
func (r *PRTitleResolver) finishFetch(prURL string, f *titleFlight, res fetchResult) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f.label = res.label
	if res.attempted {
		now := r.now()
		prev, has := r.cache[prURL]
		e := nextCacheEntry(prev, has, res, now)
		r.putCacheLocked(prURL, e, now)
		f.label = e.label
	}
	delete(r.inflight, prURL)
	close(f.done)
}

// putCacheLocked stores e. Expired entries are kept (they are served while refreshing) until the
// cache is full; then they go first, and then an arbitrary entry.
func (r *PRTitleResolver) putCacheLocked(prURL string, e cacheTitleEntry, now time.Time) {
	if _, exists := r.cache[prURL]; !exists && len(r.cache) >= prTitleCacheMaxEntries {
		r.evictExpiredLocked(now)
		for k := range r.cache {
			if len(r.cache) < prTitleCacheMaxEntries {
				break
			}
			delete(r.cache, k)
		}
	}
	r.cache[prURL] = e
}

func (r *PRTitleResolver) evictExpiredLocked(now time.Time) {
	for k, e := range r.cache {
		if !now.Before(e.expiry) {
			delete(r.cache, k)
		}
	}
}

// fetch asks GitHub for the title: it returns the title and true when GitHub answered with a
// non-empty one, otherwise the fallback and false.
func (r *PRTitleResolver) fetch(ctx context.Context, prURL, fallback string) (string, bool) {
	parts := prURLPattern.FindStringSubmatch(prURL)
	if len(parts) != 3 {
		return fallback, false
	}
	num, ok := pullNumberFromPRURL(prURL)
	if !ok {
		return fallback, false
	}
	owner, repo := parts[1], parts[2]
	apiURL := githubPullAPIBase + owner + "/" + repo + "/pulls/" + num

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return fallback, false
	}
	req.Header.Set("User-Agent", prTitleUserAgent)
	if r.token != "" {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}

	res, err := r.client.Do(req)
	if err != nil {
		return fallback, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, res.Body)
		return fallback, false
	}
	var body githubPullResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 64*1024)).Decode(&body); err != nil {
		return fallback, false
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		return fallback, false
	}
	return title, true
}

// ResolvePRTitleLabel returns a non-empty display label for a PR URL (API title or fallback).
func ResolvePRTitleLabel(ctx context.Context, r *PRTitleResolver, url string) string {
	if r == nil {
		return FallbackPRTitle(url)
	}
	label := r.Resolve(ctx, url)
	if label == "" {
		return FallbackPRTitle(url)
	}
	return label
}

// resolvePRTitleLabels resolves the labels of urls concurrently (GitHub requests are bounded by
// the resolver's slots), keeping their order.
func resolvePRTitleLabels(ctx context.Context, r *PRTitleResolver, urls []string) []string {
	labels := make([]string, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			labels[i] = ResolvePRTitleLabel(ctx, r, u)
		}(i, u)
	}
	wg.Wait()
	return labels
}

func attachPRTitles(ctx context.Context, r *PRTitleResolver, item *Item) {
	if len(item.PRURLs) == 0 {
		item.PRTitles = []string{}
		return
	}
	limit := len(item.PRURLs)
	if limit > maxPRTitleBatch {
		limit = maxPRTitleBatch
	}
	titles := resolvePRTitleLabels(ctx, r, item.PRURLs[:limit])
	for i := limit; i < len(item.PRURLs); i++ {
		titles = append(titles, FallbackPRTitle(item.PRURLs[i]))
	}
	item.PRTitles = titles
}

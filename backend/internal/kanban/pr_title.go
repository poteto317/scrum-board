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
	prTitleAPITimeout    = 2 * time.Second
	prTitleCacheTTL      = 10 * time.Minute
	prTitleMaxConcurrent = 8
	prTitleUserAgent     = "scrum-board-kanban"
	githubPullAPIBase    = "https://api.github.com/repos/"
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
type PRTitleResolver struct {
	client *http.Client
	token  string
	mu     sync.Mutex
	cache  map[string]cacheTitleEntry
	slots  chan struct{}
}

type cacheTitleEntry struct {
	label  string
	expiry time.Time
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
		client: &http.Client{Timeout: prTitleAPITimeout, Transport: rt},
		token:  tok,
		cache:  make(map[string]cacheTitleEntry),
		slots:  make(chan struct{}, prTitleMaxConcurrent),
	}
}

type githubPullResponse struct {
	Title string `json:"title"`
}

// Resolve returns the PR title or FallbackPRTitle; never empty for valid PR URLs.
func (r *PRTitleResolver) Resolve(ctx context.Context, prURL string) string {
	fallback := FallbackPRTitle(prURL)
	if !validPRURL(prURL) {
		return fallback
	}
	now := time.Now()
	r.mu.Lock()
	if e, ok := r.cache[prURL]; ok && now.Before(e.expiry) {
		label := e.label
		r.mu.Unlock()
		return label
	}
	r.mu.Unlock()

	label, cachedOK := r.fetch(ctx, prURL, fallback)
	if cachedOK {
		r.mu.Lock()
		r.cache[prURL] = cacheTitleEntry{label: label, expiry: now.Add(prTitleCacheTTL)}
		r.mu.Unlock()
	}
	return label
}

// fetch returns (label, cacheOK). cacheOK is true only for a successful GitHub title.
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

	select {
	case r.slots <- struct{}{}:
	case <-ctx.Done():
		return fallback, false
	}
	defer func() { <-r.slots }()

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

func attachPRTitles(ctx context.Context, r *PRTitleResolver, item *Item) {
	if len(item.PRURLs) == 0 {
		item.PRTitles = []string{}
		return
	}
	titles := make([]string, len(item.PRURLs))
	limit := len(item.PRURLs)
	if limit > maxPRTitleBatch {
		limit = maxPRTitleBatch
	}
	var wg sync.WaitGroup
	for i := 0; i < limit; i++ {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			titles[i] = ResolvePRTitleLabel(ctx, r, u)
		}(i, item.PRURLs[i])
	}
	wg.Wait()
	for i := limit; i < len(item.PRURLs); i++ {
		titles[i] = FallbackPRTitle(item.PRURLs[i])
	}
	item.PRTitles = titles
}
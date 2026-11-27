package kanban

import (
	"context"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

func stripHTMLSpace(s string) string {
	return strings.Join(strings.FieldsFunc(s, unicode.IsSpace), " ")
}

const (
	linkPreviewCacheTTLSuccess = 10 * time.Minute
	linkPreviewCacheTTLFailure = time.Minute
	linkPreviewStaleMaxAge     = time.Hour
	linkPreviewCacheMaxEntries = 512
	linkPreviewMaxConcurrent   = 8
	linkPreviewMaxBody         = 512 << 10
	linkPreviewMaxTitleRunes   = 200
	linkPreviewUserAgent       = "scrum-board-link-preview"
)

var (
	reOGTitle      = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>`)
	reOGTitleAlt   = regexp.MustCompile(`(?is)<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>`)
	reTwitterTitle = regexp.MustCompile(`(?is)<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']*)["'][^>]*>`)
	reTwitterAlt   = regexp.MustCompile(`(?is)<meta[^>]+content=["']([^"']*)["'][^>]*name=["']twitter:title["'][^>]*>`)
	reHTMLTitle    = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

type linkPreviewCacheEntry struct {
	title  string
	ok     bool
	expiry time.Time
	okAt   time.Time
}

type linkPreviewFlight struct {
	done  chan struct{}
	title string
	ok    bool
}

// LinkPreviewResolver fetches HTML titles with SSRF-safe client and in-process cache.
type LinkPreviewResolver struct {
	client    *http.Client
	mu        sync.Mutex
	cache     map[string]linkPreviewCacheEntry
	slots     chan struct{}
	inflight  map[string]*linkPreviewFlight
	now       func() time.Time
	logf      func(format string, args ...any) // optional; must not log response bodies
}

func NewLinkPreviewResolver() *LinkPreviewResolver {
	return newLinkPreviewResolverWithClient(newLinkPreviewHTTPClient())
}

func newLinkPreviewResolverWithClient(c *http.Client) *LinkPreviewResolver {
	if c == nil {
		c = newLinkPreviewHTTPClient()
	}
	return &LinkPreviewResolver{
		client:   c,
		cache:    make(map[string]linkPreviewCacheEntry),
		slots:    make(chan struct{}, linkPreviewMaxConcurrent),
		inflight: make(map[string]*linkPreviewFlight),
		now:      time.Now,
		logf:     func(string, ...any) {},
	}
}

func sanitizeLinkPreviewTitle(raw string) string {
	s := html.UnescapeString(raw)
	s = stripHTMLSpace(s)
	if s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) > linkPreviewMaxTitleRunes {
		runes = runes[:linkPreviewMaxTitleRunes]
	}
	return string(runes)
}

func extractLinkPreviewTitle(htmlBody string) string {
	for _, re := range []*regexp.Regexp{reOGTitle, reOGTitleAlt, reTwitterTitle, reTwitterAlt, reHTMLTitle} {
		m := re.FindStringSubmatch(htmlBody)
		if len(m) < 2 {
			continue
		}
		if t := sanitizeLinkPreviewTitle(m[1]); t != "" {
			return t
		}
	}
	return ""
}

func contentTypeAllowsHTML(ct string) bool {
	ct = strings.ToLower(ct)
	return strings.Contains(ct, "text/html") ||
		strings.Contains(ct, "+html") ||
		strings.Contains(ct, "xhtml+xml")
}

func (r *LinkPreviewResolver) Resolve(ctx context.Context, rawURL string) (string, bool) {
	u, err := validateLinkPreviewURLContext(ctx, rawURL)
	if err != nil {
		return "", false
	}
	// Prefer caller-trimmed raw when it round-trips; otherwise canonical String().
	key := strings.TrimSpace(rawURL)
	if key == "" {
		key = u.String()
	}

	r.mu.Lock()
	if e, ok := r.cache[key]; ok {
		now := r.now()
		if e.ok {
			if now.Before(e.expiry) {
				r.mu.Unlock()
				return e.title, true
			}
			// SWR: return stale success and refresh in background if still within stale max age.
			if !e.okAt.IsZero() && now.Sub(e.okAt) <= linkPreviewStaleMaxAge {
				title := e.title
				r.scheduleRefreshLocked(key)
				r.mu.Unlock()
				return title, true
			}
		} else if now.Before(e.expiry) {
			r.mu.Unlock()
			return "", false
		}
	}

	if fl, ok := r.inflight[key]; ok {
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return "", false
		case <-fl.done:
			return fl.title, fl.ok
		}
	}
	fl := &linkPreviewFlight{done: make(chan struct{})}
	r.inflight[key] = fl
	r.mu.Unlock()

	title, ok := r.fetch(ctx, key)
	r.mu.Lock()
	fl.title, fl.ok = title, ok
	close(fl.done)
	delete(r.inflight, key)
	r.storeLocked(key, title, ok)
	r.mu.Unlock()
	return title, ok
}

// scheduleRefreshLocked starts at most one background refresh per key (caller holds mu).
func (r *LinkPreviewResolver) scheduleRefreshLocked(key string) {
	if _, ok := r.inflight[key]; ok {
		return
	}
	fl := &linkPreviewFlight{done: make(chan struct{})}
	r.inflight[key] = fl
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), linkPreviewHTTPTimeout)
		defer cancel()
		title, ok := r.fetch(ctx, key)
		r.mu.Lock()
		fl.title, fl.ok = title, ok
		close(fl.done)
		delete(r.inflight, key)
		if ok {
			r.storeLocked(key, title, true)
		} else {
			e, exists := r.cache[key]
			keepSuccess := exists && e.ok && !e.okAt.IsZero() && r.now().Sub(e.okAt) <= linkPreviewStaleMaxAge
			if !keepSuccess {
				r.storeLocked(key, "", false)
			}
		}
		r.mu.Unlock()
	}()
}

func (r *LinkPreviewResolver) storeLocked(key, title string, ok bool) {
	now := r.now()
	e := linkPreviewCacheEntry{title: title, ok: ok}
	if ok {
		e.expiry = now.Add(linkPreviewCacheTTLSuccess)
		e.okAt = now
	} else {
		e.expiry = now.Add(linkPreviewCacheTTLFailure)
	}
	if len(r.cache) >= linkPreviewCacheMaxEntries {
		var oldestKey string
		var oldest time.Time
		first := true
		for k, ent := range r.cache {
			mark := ent.expiry
			if ent.ok && !ent.okAt.IsZero() && ent.okAt.Before(mark) {
				mark = ent.okAt
			}
			if first || mark.Before(oldest) {
				oldestKey = k
				oldest = mark
				first = false
			}
		}
		if oldestKey != "" {
			delete(r.cache, oldestKey)
		}
	}
	r.cache[key] = e
}

func (r *LinkPreviewResolver) fetch(ctx context.Context, pageURL string) (string, bool) {
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return "", false
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		r.logf("link preview request build failed")
		return "", false
	}
	req.Header.Set("User-Agent", linkPreviewUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	res, err := r.client.Do(req)
	if err != nil {
		r.logf("link preview fetch failed")
		return "", false
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		r.logf("link preview status %d", res.StatusCode)
		return "", false
	}
	if !contentTypeAllowsHTML(res.Header.Get("Content-Type")) {
		return "", false
	}
	limited := io.LimitReader(res.Body, linkPreviewMaxBody+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		r.logf("link preview body read failed")
		return "", false
	}
	if len(body) > linkPreviewMaxBody {
		body = body[:linkPreviewMaxBody]
	}
	title := extractLinkPreviewTitle(string(body))
	if title == "" || !utf8.ValidString(title) {
		return "", false
	}
	return title, true
}

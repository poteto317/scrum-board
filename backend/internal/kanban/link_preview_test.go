package kanban

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type linkPreviewRoundTripFunc func(*http.Request) (*http.Response, error)

func (f linkPreviewRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func htmlResponse(body, contentType string) *http.Response {
	if contentType == "" {
		contentType = "text/html; charset=utf-8"
	}
	return &http.Response{
		StatusCode: 200,
		Header:     http.Header{"Content-Type": []string{contentType}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func withPublicDNS(t *testing.T) {
	t.Helper()
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
}

func TestLinkPreviewResolveOGTitle(t *testing.T) {
	withPublicDNS(t)
	var hits atomic.Int32
	rt := linkPreviewRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		hits.Add(1)
		if req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatal("auth headers must not be set")
		}
		return htmlResponse(`<html><head><meta property="og:title" content="OG &amp; Title"></head></html>`, ""), nil
	})
	r := newLinkPreviewResolverWithClient(&http.Client{Timeout: time.Second, Transport: rt})
	title, ok := r.Resolve(context.Background(), "https://example.com/a")
	if !ok || title != "OG & Title" {
		t.Fatalf("got %q %v", title, ok)
	}
	if hits.Load() != 1 {
		t.Fatalf("hits %d", hits.Load())
	}
	// cache hit
	title, ok = r.Resolve(context.Background(), "https://example.com/a")
	if !ok || title != "OG & Title" || hits.Load() != 1 {
		t.Fatalf("cache: %q %v hits=%d", title, ok, hits.Load())
	}
}

func TestLinkPreviewTitleFallbacksAndLimits(t *testing.T) {
	withPublicDNS(t)
	cases := []struct {
		body, ct, want string
		ok             bool
	}{
		{`<meta name="twitter:title" content="Tw">`, "text/html", "Tw", true},
		{`<title>  Page&#39;s  </title>`, "text/html", "Page's", true},
		{`<title>x</title>`, "application/xhtml+xml", "x", true},
		{`<title>plain</title>`, "application/json", "", false},
		{`<title>` + strings.Repeat("あ", 250) + `</title>`, "text/html", strings.Repeat("あ", 200), true},
		{`<title>   </title>`, "text/html", "", false},
	}
	for i, tc := range cases {
		rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return htmlResponse(tc.body, tc.ct), nil
		})
		r := newLinkPreviewResolverWithClient(&http.Client{Timeout: time.Second, Transport: rt})
		title, ok := r.Resolve(context.Background(), "https://example.com/f/"+string(rune('a'+i)))
		if ok != tc.ok || title != tc.want {
			t.Fatalf("case %d: got %q %v want %q %v", i, title, ok, tc.want, tc.ok)
		}
	}
}

func TestLinkPreviewInflightShared(t *testing.T) {
	withPublicDNS(t)
	var started sync.WaitGroup
	started.Add(1)
	release := make(chan struct{})
	var hits atomic.Int32
	rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
		hits.Add(1)
		started.Done()
		<-release
		return htmlResponse(`<title>shared</title>`, ""), nil
	})
	r := newLinkPreviewResolverWithClient(&http.Client{Timeout: 2 * time.Second, Transport: rt})
	var wg sync.WaitGroup
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			title, ok := r.Resolve(context.Background(), "https://example.com/inflight")
			if !ok || title != "shared" {
				t.Errorf("got %q %v", title, ok)
			}
		}()
	}
	started.Wait()
	close(release)
	wg.Wait()
	if hits.Load() != 1 {
		t.Fatalf("hits %d", hits.Load())
	}
}

func TestLinkPreviewSWRAndStaleIfError(t *testing.T) {
	withPublicDNS(t)
	var hits atomic.Int32
	fail := atomic.Bool{}
	rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
		hits.Add(1)
		if fail.Load() {
			return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
		}
		return htmlResponse(`<title>live</title>`, ""), nil
	})
	r := newLinkPreviewResolverWithClient(&http.Client{Timeout: time.Second, Transport: rt})
	now := time.Now()
	r.now = func() time.Time { return now }

	title, ok := r.Resolve(context.Background(), "https://example.com/swr")
	if !ok || title != "live" {
		t.Fatalf("first %q %v", title, ok)
	}
	// Expire success TTL but within stale max age.
	now = now.Add(linkPreviewCacheTTLSuccess + time.Second)
	fail.Store(true)
	title, ok = r.Resolve(context.Background(), "https://example.com/swr")
	if !ok || title != "live" {
		t.Fatalf("swr %q %v", title, ok)
	}
	// Allow background refresh to finish (failure must not wipe success).
	time.Sleep(50 * time.Millisecond)
	title, ok = r.Resolve(context.Background(), "https://example.com/swr")
	if !ok || title != "live" {
		t.Fatalf("stale-if-error %q %v", title, ok)
	}
}

func TestExtractLinkPreviewTitleOrder(t *testing.T) {
	html := `<title>T</title><meta property="og:title" content="OG"><meta name="twitter:title" content="TW">`
	if got := extractLinkPreviewTitle(html); got != "OG" {
		t.Fatalf("got %q", got)
	}
}

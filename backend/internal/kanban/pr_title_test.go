package kanban

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFallbackPRTitle(t *testing.T) {
	url := "https://github.com/poteto317/scrum-board/pull/42"
	got := FallbackPRTitle(url)
	if got != "poteto317/scrum-board#42" {
		t.Fatalf("got %q", got)
	}
	if strings.Contains(got, "https://") {
		t.Fatal("must not contain full URL")
	}
	for _, bad := range []string{
		"",
		"https://evil.example/x",
		"https://github.com.evil/o/r/pull/1",
		"javascript:alert(1)",
	} {
		fb := FallbackPRTitle(bad)
		if strings.HasPrefix(fb, "http") || strings.Contains(fb, "github.com/") {
			t.Fatalf("bad %q -> %q", bad, fb)
		}
	}
}

func TestPRTitleResolverSuccess(t *testing.T) {
	url := "https://github.com/o/r/pull/7"
	var calls atomic.Int32
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		if req.Header.Get("User-Agent") == "" {
			t.Fatal("missing User-Agent")
		}
		if got := req.URL.Path; got != "/repos/o/r/pulls/7" {
			t.Fatalf("path %q", got)
		}
		body := `{"title":"  My PR Title  "}`
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})
	r := NewPRTitleResolver(rt)
	ctx := context.Background()
	if got := r.Resolve(ctx, url); got != "My PR Title" {
		t.Fatalf("got %q", got)
	}
	if got := r.Resolve(ctx, url); got != "My PR Title" {
		t.Fatalf("cache second %q", got)
	}
	if calls.Load() != 1 {
		t.Fatalf("round trips %d want 1", calls.Load())
	}
}

func TestPRTitleResolver404AndInvalidJSON(t *testing.T) {
	url := "https://github.com/o/r/pull/1"
	var calls atomic.Int32
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		n := calls.Add(1)
		if n == 1 {
			return &http.Response{
				StatusCode: 404,
				Body:       io.NopCloser(strings.NewReader(`{"message":"Not Found"}`)),
			}, nil
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"Recovered"}`)),
		}, nil
	})
	r := NewPRTitleResolver(rt)
	got := r.Resolve(context.Background(), url)
	want := "o/r#1"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if strings.Contains(got, "Not Found") || strings.Contains(got, "Bearer") {
		t.Fatal("must not leak response body")
	}
	if got2 := r.Resolve(context.Background(), url); got2 != want {
		t.Fatalf("failure should be cached briefly: %q (calls=%d)", got2, calls.Load())
	}
	if calls.Load() != 1 {
		t.Fatalf("calls %d want 1", calls.Load())
	}
}

func TestPRTitleResolverTimeout(t *testing.T) {
	url := "https://github.com/o/r/pull/2"
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		time.Sleep(3 * time.Second)
		return nil, context.DeadlineExceeded
	})
	r := NewPRTitleResolver(rt)
	r.client.Timeout = 50 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	got := r.Resolve(ctx, url)
	if got != "o/r#2" {
		t.Fatalf("got %q", got)
	}
}

func TestPRTitleResolverEmptyTitleUsesFallback(t *testing.T) {
	url := "https://github.com/a/b/pull/3"
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"   "}`)),
		}, nil
	})
	r := NewPRTitleResolver(rt)
	if got := r.Resolve(context.Background(), url); got != "a/b#3" {
		t.Fatalf("got %q", got)
	}
}

func TestPRTitleResolverTokenNotInLabel(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "ghp_supersecret_not_in_output")
	url := "https://github.com/o/r/pull/9"
	var auth string
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		auth = req.Header.Get("Authorization")
		return &http.Response{
			StatusCode: 500,
			Body:       io.NopCloser(strings.NewReader(`Bearer leaked`)),
		}, nil
	})
	r := NewPRTitleResolver(rt)
	got := r.Resolve(context.Background(), url)
	if !strings.HasPrefix(auth, "Bearer ghp_") {
		t.Fatalf("auth %q", auth)
	}
	if strings.Contains(got, "ghp_") || strings.Contains(got, "Bearer") {
		t.Fatalf("label leaked secret: %q", got)
	}
	payload, _ := json.Marshal(map[string]string{"label": got})
	if strings.Contains(string(payload), "ghp_") {
		t.Fatal("json must not contain token")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
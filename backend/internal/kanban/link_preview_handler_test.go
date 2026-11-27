package kanban

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBatchLinkPreviews(t *testing.T) {
	withPublicDNS(t)
	var hits atomic.Int32
	rt := linkPreviewRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		hits.Add(1)
		time.Sleep(30 * time.Millisecond)
		return htmlResponse(`<title>`+req.URL.Path+`</title>`, ""), nil
	})
	resolver := newLinkPreviewResolverWithClient(&http.Client{Timeout: 2 * time.Second, Transport: rt})
	h := NewHandler(fresh(), WithLinkPreviewResolver(resolver))

	body := `{"urls":["https://example.com/one","https://example.com/one","http://bad.example/","https://example.com/two"]}`
	w := request(h, "POST", "/api/link-previews", body)
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Previews map[string]linkPreviewEntry `json:"previews"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Previews) != 2 {
		t.Fatalf("previews %#v", out.Previews)
	}
	if !out.Previews["https://example.com/one"].OK || out.Previews["https://example.com/one"].Title != "/one" {
		t.Fatalf("one %#v", out.Previews["https://example.com/one"])
	}
	if _, bad := out.Previews["http://bad.example/"]; bad {
		t.Fatal("invalid url must not appear as key")
	}
	if hits.Load() != 2 {
		t.Fatalf("expected parallel unique fetches, hits=%d", hits.Load())
	}
}

func TestBatchLinkPreviewsTooMany(t *testing.T) {
	withPublicDNS(t)
	rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return htmlResponse(`<title>x</title>`, ""), nil
	})
	h := NewHandler(fresh(), WithLinkPreviewResolver(newLinkPreviewResolverWithClient(&http.Client{Transport: rt})))
	urls := make([]string, 0, 21)
	for i := 0; i < 21; i++ {
		urls = append(urls, `"https://example.com/`+strings.Repeat("p", i+1)+`"`)
	}
	w := request(h, "POST", "/api/link-previews", `{"urls":[`+strings.Join(urls, ",")+`]}`)
	if w.Code != 400 {
		t.Fatalf("status %d", w.Code)
	}
}

func TestBatchLinkPreviewsKeyMatchesTrimmedRaw(t *testing.T) {
	withPublicDNS(t)
	raw := "https://example.com/" + string([]rune("パス"))
	rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return htmlResponse(`<title>JP</title>`, ""), nil
	})
	h := NewHandler(fresh(), WithLinkPreviewResolver(newLinkPreviewResolverWithClient(&http.Client{Transport: rt})))
	body, err := json.Marshal(map[string][]string{"urls": {raw}})
	if err != nil {
		t.Fatal(err)
	}
	w := request(h, "POST", "/api/link-previews", string(body))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var out struct {
		Previews map[string]linkPreviewEntry `json:"previews"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if e, ok := out.Previews[raw]; !ok || !e.OK || e.Title != "JP" {
		t.Fatalf("key must be trimmed raw URL, got %#v", out.Previews)
	}
}

func TestBatchLinkPreviewsUnauthorized(t *testing.T) {
	h := NewHandler(fresh())
	w := requestWithCookie(h, "POST", "/api/link-previews", `{"urls":[]}`, "")
	if w.Code != 401 {
		t.Fatalf("status %d", w.Code)
	}
}

func TestBatchLinkPreviewsOkFalse(t *testing.T) {
	withPublicDNS(t)
	rt := linkPreviewRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
	})
	h := NewHandler(fresh(), WithLinkPreviewResolver(newLinkPreviewResolverWithClient(&http.Client{Transport: rt})))
	w := request(h, "POST", "/api/link-previews", `{"urls":["https://example.com/fail"]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var out struct {
		Previews map[string]linkPreviewEntry `json:"previews"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	e := out.Previews["https://example.com/fail"]
	if e.OK || e.Title != "" {
		t.Fatalf("%#v", e)
	}
}

func TestIsPublicIP(t *testing.T) {
	if isPublicIP(net.ParseIP("8.8.8.8")) != true {
		t.Fatal("8.8.8.8")
	}
	if isPublicIP(net.ParseIP("10.1.2.3")) {
		t.Fatal("10.x")
	}
	if isPublicIP(net.ParseIP("fc00::1")) {
		t.Fatal("ula")
	}
}

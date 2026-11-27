package kanban

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateLinkPreviewURLRejects(t *testing.T) {
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("8.8.8.8")}, nil
	}

	cases := []string{
		"http://example.com/",
		"https://user:pass@example.com/",
		"https://127.0.0.1/",
		"https://10.0.0.1/",
		"https://[::1]/",
		"https://100.64.0.1/",
		"https://169.254.1.1/",
		"https://224.0.0.1/",
		"https://localhost/",
		"https://Metadata.Google.Internal/",
		"https://example.com/path(1)",
		"https://example.com/\x01",
		strings.Repeat("https://example.com/", 200), // overlong when concatenated oddly — use long path
	}
	long := "https://example.com/" + strings.Repeat("a", linkPreviewMaxURLLen)
	cases = append(cases, long)

	for _, raw := range cases {
		if _, err := validateLinkPreviewURL(raw); err == nil {
			t.Fatalf("expected reject for %q", raw)
		}
	}
}

func TestValidateLinkPreviewURLAcceptsPublic(t *testing.T) {
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	u, err := validateLinkPreviewURL("https://example.com/path")
	if err != nil || u.Host != "example.com" {
		t.Fatalf("got %v %v", u, err)
	}
}

func TestValidateLinkPreviewURLRejectsMixedDNS(t *testing.T) {
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("8.8.8.8"), net.ParseIP("10.0.0.2")}, nil
	}
	if _, err := validateLinkPreviewURL("https://evil.example/"); err == nil {
		t.Fatal("expected reject when any A/AAAA is private")
	}
}

func TestLinkPreviewClientOmitsAuthHeaders(t *testing.T) {
	var sawAuth, sawCookie bool
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth = true
		}
		if r.Header.Get("Cookie") != "" {
			sawCookie = true
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<title>ok</title>`))
	}))
	t.Cleanup(srv.Close)

	// Bypass DNS/public IP for loopback test server by using custom transport only —
	// auth omission is what we assert here.
	c := newLinkPreviewHTTPClientWithTransport(srv.Client().Transport)
	req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("User-Agent", "scrum-board-link-preview")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if sawAuth || sawCookie {
		t.Fatalf("auth=%v cookie=%v", sawAuth, sawCookie)
	}
}

func TestLinkPreviewRedirectToPrivateRejected(t *testing.T) {
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("8.8.8.8")}, nil
	}

	public := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://127.0.0.1/secret", http.StatusFound)
	}))
	t.Cleanup(public.Close)

	c := newLinkPreviewHTTPClientWithTransport(public.Client().Transport)
	req, _ := http.NewRequest(http.MethodGet, public.URL, nil)
	_, err := c.Do(req)
	if err == nil {
		t.Fatal("expected redirect to private https IP to be rejected")
	}
}

func TestLinkPreviewRedirectHTTPRejected(t *testing.T) {
	public := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com/", http.StatusFound)
	}))
	t.Cleanup(public.Close)
	c := newLinkPreviewHTTPClientWithTransport(public.Client().Transport)
	req, _ := http.NewRequest(http.MethodGet, public.URL, nil)
	if _, err := c.Do(req); err == nil {
		t.Fatal("expected http redirect reject")
	}
}

func TestFEBERejectParity(t *testing.T) {
	orig := linkPreviewLookupIP
	t.Cleanup(func() { linkPreviewLookupIP = orig })
	linkPreviewLookupIP = func(ctx context.Context, network, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("1.1.1.1")}, nil
	}
	// Mirror frontend normalizeDescriptionLinkUrl rejection cases.
	for _, raw := range []string{
		"http://example.com",
		"ftp://example.com",
		"https://example.com/a(b)",
		"https://example.com/a\nb",
		"",
	} {
		if _, err := validateLinkPreviewURL(raw); err == nil {
			t.Fatalf("FE/BE parity: want reject %q", raw)
		}
	}
}

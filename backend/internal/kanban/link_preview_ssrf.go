package kanban

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	linkPreviewMaxURLLen   = 2048
	linkPreviewHTTPTimeout = 3 * time.Second
	linkPreviewMaxRedirect = 3
)

// Overridable in tests.
var linkPreviewLookupIP = net.DefaultResolver.LookupIP

var blockedLinkPreviewHostnames = map[string]struct{}{
	"localhost":                {},
	"metadata.google.internal": {},
	"metadata":                 {},
	"kubernetes.default":       {},
	"kubernetes.default.svc":   {},
}

func blockedLinkPreviewHostname(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	_, ok := blockedLinkPreviewHostnames[h]
	return ok
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}
	if !ip.IsGlobalUnicast() {
		return false
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	// CGNAT 100.64.0.0/10
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return false
		}
	}
	return true
}

func hasDisallowedURLRunes(s string) bool {
	for _, r := range s {
		if r <= 0x1f || (r >= 0x7f && r <= 0x9f) || r == 0x2028 || r == 0x2029 || r == '(' || r == ')' {
			return true
		}
	}
	return false
}

// parseLinkPreviewURL is pure syntax validation (same spirit as frontend normalizeDescriptionLinkUrl).
func parseLinkPreviewURL(raw string) (*url.URL, error) {
	text := strings.TrimSpace(raw)
	// Match frontend string length (JS UTF-16 ≈ rune count for BMP URLs we allow).
	if text == "" || utf8.RuneCountInString(text) > linkPreviewMaxURLLen || hasDisallowedURLRunes(text) {
		return nil, fmt.Errorf("invalid url")
	}
	if !strings.HasPrefix(text, "https://") {
		return nil, fmt.Errorf("https required")
	}
	u, err := url.Parse(text)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "https" {
		return nil, fmt.Errorf("https required")
	}
	if u.User != nil {
		return nil, fmt.Errorf("userinfo forbidden")
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("blocked host")
	}
	return u, nil
}

// ensureLinkPreviewHostPublic performs DNS / IP public checks (I/O).
func ensureLinkPreviewHostPublic(ctx context.Context, u *url.URL) error {
	host := u.Hostname()
	if blockedLinkPreviewHostname(host) {
		return fmt.Errorf("blocked host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return fmt.Errorf("non-public ip")
		}
		return nil
	}
	ips, err := linkPreviewLookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("dns lookup failed")
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return fmt.Errorf("non-public dns")
		}
	}
	return nil
}

// validateLinkPreviewURL parses then ensures the host resolves only to public IPs.
func validateLinkPreviewURL(raw string) (*url.URL, error) {
	return validateLinkPreviewURLContext(context.Background(), raw)
}

func validateLinkPreviewURLContext(ctx context.Context, raw string) (*url.URL, error) {
	u, err := parseLinkPreviewURL(raw)
	if err != nil {
		return nil, err
	}
	if err := ensureLinkPreviewHostPublic(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

func dialLinkPreview(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		ips, err := linkPreviewLookupIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, fmt.Errorf("dns lookup failed")
		}
		for _, candidate := range ips {
			if !isPublicIP(candidate) {
				return nil, fmt.Errorf("non-public dial target")
			}
		}
		ip = ips[0]
	} else if !isPublicIP(ip) {
		return nil, fmt.Errorf("non-public dial target")
	}
	var d net.Dialer
	return d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
}

func newLinkPreviewHTTPClient() *http.Client {
	return newLinkPreviewHTTPClientWithTransport(nil)
}

func newLinkPreviewHTTPClientWithTransport(rt http.RoundTripper) *http.Client {
	base := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialLinkPreview,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          16,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   3 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if rt == nil {
		rt = base
	} else {
		// Tests inject RoundTripper; Dial still applies only when using base. Keep CheckRedirect.
	}
	client := &http.Client{
		Timeout:   linkPreviewHTTPTimeout,
		Transport: rt,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= linkPreviewMaxRedirect {
				return fmt.Errorf("too many redirects")
			}
			if _, err := validateLinkPreviewURLContext(req.Context(), req.URL.String()); err != nil {
				return err
			}
			// Never forward auth from our app (we never set it); strip just in case.
			req.Header.Del("Authorization")
			req.Header.Del("Cookie")
			return nil
		},
	}
	return client
}

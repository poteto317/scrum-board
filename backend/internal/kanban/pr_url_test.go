package kanban

import (
	"strings"
	"testing"
)

func TestPRURLLength(t *testing.T) {
	prefix := "https://github.com/"
	suffix := "/repo/pull/1"
	url := prefix + strings.Repeat("a", 2048-len(prefix)-len(suffix)) + suffix
	if !validPRURL(url) {
		t.Fatal("2048 bytes must be accepted")
	}
	if validPRURL(url + "1") {
		t.Fatal("2049 bytes must be rejected")
	}
}

func TestNormalizePRURLs(t *testing.T) {
	u1 := "https://github.com/a/b/pull/1"
	u2 := "https://github.com/a/b/pull/2"
	got, ok := normalizePRURLs([]string{"  " + u1 + " ", u2})
	if !ok || len(got) != 2 || got[0] != u1 || got[1] != u2 {
		t.Fatalf("got %v ok=%v", got, ok)
	}
	if _, ok := normalizePRURLs([]string{""}); ok {
		t.Fatal("empty element must fail")
	}
	if _, ok := normalizePRURLs([]string{"  "}); ok {
		t.Fatal("whitespace element must fail")
	}
	if _, ok := normalizePRURLs([]string{u1, u1}); ok {
		t.Fatal("duplicate must fail")
	}
	if _, ok := normalizePRURLs([]string{"https://evil.example/x"}); ok {
		t.Fatal("invalid must fail")
	}
	got, ok = normalizePRURLs(nil)
	if !ok || got == nil || len(got) != 0 {
		t.Fatalf("nil input -> empty slice, got %#v ok=%v", got, ok)
	}
}

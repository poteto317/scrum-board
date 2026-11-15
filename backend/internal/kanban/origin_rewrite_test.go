package kanban

import (
	"strings"
	"testing"
)

func TestReplaceLocalBoardOrigins(t *testing.T) {
	target := "https://prod.example"
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"open http://127.0.0.1:4200/cards/1", "open https://prod.example/cards/1"},
		{"open http://127.0.0.1:4200/", "open https://prod.example/"},
		{"x http://localhost:4200 y", "x https://prod.example y"},
		{"http://localhost:4200/", "https://prod.example/"},
		{"both http://127.0.0.1:4200 and http://localhost:4200/", "both https://prod.example and https://prod.example/"},
		{"https://github.com/org/repo/pull/1", "https://github.com/org/repo/pull/1"},
		{"{{url}} stays", "{{url}} stays"},
	}
	for _, tc := range cases {
		if got := ReplaceLocalBoardOrigins(tc.in, target); got != tc.want {
			t.Fatalf("ReplaceLocalBoardOrigins(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestContainsLocalBoardOrigin(t *testing.T) {
	if !ContainsLocalBoardOrigin("http://127.0.0.1:4200/cards/1") {
		t.Fatal("expected 127.0.0.1 match")
	}
	if !ContainsLocalBoardOrigin("http://localhost:4200/") {
		t.Fatal("expected localhost match")
	}
	if ContainsLocalBoardOrigin("https://example.com") {
		t.Fatal("unexpected match")
	}
}

func TestValidateRewriteTarget(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		err      string
	}{
		{"", "", "non-empty"},
		{"   ", "", "non-empty"},
		{"ftp://x", "", "http"},
		{"https://run.app/", "https://run.app", ""},
		{" https://run.app/ ", "https://run.app", ""},
	} {
		got, err := ValidateRewriteTarget(tc.in)
		switch {
		case tc.err != "" && (err == nil || !strings.Contains(err.Error(), tc.err)):
			t.Fatalf("ValidateRewriteTarget(%q) err=%v want %q", tc.in, err, tc.err)
		case tc.err == "" && err != nil:
			t.Fatalf("ValidateRewriteTarget(%q) unexpected err: %v", tc.in, err)
		case tc.err == "" && got != tc.want:
			t.Fatalf("ValidateRewriteTarget(%q) = %q want %q", tc.in, got, tc.want)
		}
	}
}

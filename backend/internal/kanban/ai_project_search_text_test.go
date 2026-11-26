package kanban

import (
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSplitSearchTerms(t *testing.T) {
	if got := splitSearchTerms("  認証　トークン\tOAuth \n"); !slices.Equal(got, []string{"認証", "トークン", "OAuth"}) {
		t.Fatalf("split=%q", got)
	}
	if got := splitSearchTerms("   "); len(got) != 0 {
		t.Fatalf("blank query must give no terms: %q", got)
	}
	if got := splitSearchTerms("a b c d e f g h i j"); !slices.Equal(got, []string{"a", "b", "c", "d", "e", "f", "g", "h"}) {
		t.Fatalf("only the first 8 terms are kept: %q", got)
	}
	// 200 文字を超える分は切り捨てる（201 文字目から先の語は無い）。
	long := strings.Repeat("あ", 199) + " いう"
	got := splitSearchTerms(long)
	if len(got) != 1 || utf8.RuneCountInString(got[0]) != 199 {
		t.Fatalf("query must be cut at 200 runes: %d terms", len(got))
	}
}

func TestEscapeLike(t *testing.T) {
	cases := map[string]string{
		"100%":   `100\%`,
		"a_b":    `a\_b`,
		`c:\dir`: `c:\\dir`,
		"普通":     "普通",
		`\%_`:    `\\\%\_`,
	}
	for in, want := range cases {
		if got := escapeLike(in); got != want {
			t.Fatalf("escapeLike(%q)=%q want %q", in, got, want)
		}
	}
}

func TestSearchTermNumber(t *testing.T) {
	for term, want := range map[string]int64{"12": 12, "#12": 12, "#7": 7} {
		if n, ok := searchTermNumber(term); !ok || n != want {
			t.Fatalf("%q => %d %v", term, n, ok)
		}
	}
	for _, term := range []string{"", "#", "0", "#0", "-1", "12a", "##12", "１２", "9999999999999999999999"} {
		if n, ok := searchTermNumber(term); ok {
			t.Fatalf("%q must not be a number, got %d", term, n)
		}
	}
}

func TestContainsFoldIgnoresCase(t *testing.T) {
	if !containsFold("Use OAuth Here", "oauth") || !containsFold("use oauth here", "OAUTH") {
		t.Fatal("case must be ignored")
	}
	if containsFold("abc", "abcd") || containsFold("abc", "") {
		t.Fatal("longer or empty needle must not match")
	}
}

func TestSearchSnippet(t *testing.T) {
	// 説明に一致があれば、その前後。
	desc := strings.Repeat("前", 300) + "KEYWORD" + strings.Repeat("後", 300)
	got := searchSnippet(desc, "ソリューション", []string{"keyword"})
	if !strings.Contains(got, "KEYWORD") || utf8.RuneCountInString(got) != itemSearchSnippetRunes {
		t.Fatalf("snippet must surround the match within 200 runes: %d %q", utf8.RuneCountInString(got), got)
	}
	if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") {
		t.Fatalf("cut sides must be marked: %q", got)
	}
	// 説明に無く、ソリューションにあれば、その前後。
	got = searchSnippet("関係ない説明", strings.Repeat("x", 250)+"needle", []string{"zzz", "NEEDLE"})
	if !strings.Contains(got, "needle") || utf8.RuneCountInString(got) > itemSearchSnippetRunes {
		t.Fatalf("solution match: %q", got)
	}
	// どちらにも無い（タイトル・コメント・番号だけの一致）なら、説明の先頭。
	got = searchSnippet("説明の先頭"+strings.Repeat("あ", 300), "sol", []string{"#12"})
	if !strings.HasPrefix(got, "説明の先頭") || utf8.RuneCountInString(got) != itemSearchSnippetRunes || !strings.HasSuffix(got, "…") {
		t.Fatalf("head of description: %q", got)
	}
	// query が空でも、説明の先頭。説明が空なら、ソリューションの先頭。
	if got = searchSnippet("短い説明", "sol", nil); got != "短い説明" {
		t.Fatalf("no terms: %q", got)
	}
	if got = searchSnippet("  ", "ソリューションだけ", nil); got != "ソリューションだけ" {
		t.Fatalf("empty description falls back to solution: %q", got)
	}
	if got = searchSnippet("", "", []string{"x"}); got != "" {
		t.Fatalf("nothing to show: %q", got)
	}
	// いちばん手前の一致を使う（語の順ではない）。
	got = searchSnippet("AAA "+strings.Repeat("・", 400)+" BBB", "", []string{"bbb", "aaa"})
	if !strings.HasPrefix(got, "AAA") {
		t.Fatalf("earliest match wins: %q", got)
	}
}

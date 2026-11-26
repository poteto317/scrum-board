package kanban

import (
	"strconv"
	"strings"
	"unicode"
)

// Pure text rules of the project chat's item search (no I/O): splitting the query,
// escaping LIKE, reading "#12" as a number, and cutting the snippet.

const (
	maxItemSearchQueryRunes = 200
	maxItemSearchTerms      = 8
	itemSearchSnippetRunes  = 200
	// How many characters of the snippet come before the first match.
	itemSearchSnippetLead = 60
)

// splitSearchTerms cuts the query to maxItemSearchQueryRunes, splits on whitespace
// (including the full-width space) and keeps the first maxItemSearchTerms words.
func splitSearchTerms(query string) []string {
	r := []rune(query)
	if len(r) > maxItemSearchQueryRunes {
		r = r[:maxItemSearchQueryRunes]
	}
	terms := strings.Fields(string(r))
	if len(terms) > maxItemSearchTerms {
		terms = terms[:maxItemSearchTerms]
	}
	return terms
}

// escapeLike makes s a literal inside a LIKE pattern whose escape character is the backslash.
func escapeLike(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// searchTermNumber reads "12" or "#12" as the item number 12. Anything else is not a number.
func searchTermNumber(term string) (int64, bool) {
	digits := strings.TrimPrefix(term, "#")
	if digits == "" || len(digits) > 18 {
		return 0, false
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func foldRunes(s string) []rune {
	r := []rune(s)
	for i, c := range r {
		r[i] = unicode.ToLower(c)
	}
	return r
}

// indexFold returns the rune index of the first case-insensitive match of term in text, or -1.
func indexFold(text []rune, term string) int {
	needle := foldRunes(term)
	if len(needle) == 0 || len(needle) > len(text) {
		return -1
	}
	for i := 0; i+len(needle) <= len(text); i++ {
		match := true
		for j, c := range needle {
			if unicode.ToLower(text[i+j]) != c {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// containsFold reports a case-insensitive substring match.
func containsFold(text, term string) bool {
	return indexFold([]rune(text), term) >= 0
}

// firstTermMatch is the earliest position in text where any of the terms matches, or -1.
func firstTermMatch(text []rune, terms []string) int {
	first := -1
	for _, term := range terms {
		if at := indexFold(text, term); at >= 0 && (first < 0 || at < first) {
			first = at
		}
	}
	return first
}

// snippetAround cuts at most itemSearchSnippetRunes characters of text around the match at index at.
// A cut side is marked with "…", which counts toward the limit.
func snippetAround(text []rune, at int) string {
	if len(text) <= itemSearchSnippetRunes {
		return string(text)
	}
	start := at - itemSearchSnippetLead
	if start < 0 {
		start = 0
	}
	room := itemSearchSnippetRunes
	prefix, suffix := "", ""
	if start > 0 {
		prefix = "…"
		room--
	}
	end := start + room
	if end < len(text) {
		suffix = "…"
		end--
	} else {
		end = len(text)
	}
	return prefix + string(text[start:end]) + suffix
}

// searchSnippet picks what a search result shows of the item: the text around the first
// match in the description, else in the solution, else the head of the description
// (the solution when the description is empty).
func searchSnippet(description, solution string, terms []string) string {
	desc, sol := []rune(description), []rune(solution)
	if at := firstTermMatch(desc, terms); at >= 0 {
		return snippetAround(desc, at)
	}
	if at := firstTermMatch(sol, terms); at >= 0 {
		return snippetAround(sol, at)
	}
	if strings.TrimSpace(description) != "" {
		return snippetAround(desc, 0)
	}
	return snippetAround(sol, 0)
}

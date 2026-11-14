package kanban

import (
	"encoding/json"
	"regexp"
	"strings"
)

var prURLPattern = regexp.MustCompile(`^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/pull/[1-9][0-9]*$`)

func validPRURL(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 2048 {
		return false
	}
	parts := prURLPattern.FindStringSubmatch(value)
	return len(parts) == 3 && parts[1] != "." && parts[1] != ".." && parts[2] != "." && parts[2] != ".."
}

func normalizePRURL(value string) (string, bool) {
	value = strings.TrimSpace(value)
	return value, validPRURL(value)
}

// normalizePRURLs trims each element. Empty or whitespace-only elements fail.
// Duplicates (exact match after trim) fail. Nil or empty input yields a non-nil empty slice.
func normalizePRURLs(values []string) ([]string, bool) {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || !validPRURL(value) {
			return nil, false
		}
		if _, dup := seen[value]; dup {
			return nil, false
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, true
}

func prURLsJSON(urls []string) string {
	if urls == nil {
		urls = []string{}
	}
	payload, err := json.Marshal(urls)
	if err != nil {
		return "[]"
	}
	return string(payload)
}

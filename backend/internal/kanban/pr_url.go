package kanban

import (
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

package kanban

import (
	"strings"
	"unicode/utf8"
)

const maxCloseReasonLen = 2000

// NormalizeCloseReason trims input. Empty is allowed. ok is false when too long or invalid UTF-8.
func NormalizeCloseReason(raw string) (value string, ok bool) {
	value = strings.TrimSpace(raw)
	if !utf8.ValidString(value) {
		return "", false
	}
	if utf8.RuneCountInString(value) > maxCloseReasonLen {
		return "", false
	}
	return value, true
}

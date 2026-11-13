package kanban

import (
	"strings"
	"unicode/utf8"
)

func validTitle(s string) bool {
	return utf8.ValidString(s) && strings.TrimSpace(s) != "" && utf8.RuneCountInString(s) <= 200
}
func validDescription(s string) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= 10000
}

func validColumnName(name string) bool {
	return utf8.ValidString(name) && strings.TrimSpace(name) != "" && utf8.RuneCountInString(name) <= 60
}

func validateColumnOrder(columnIDs []int64) error {
	if len(columnIDs) == 0 {
		return ErrColumnOrder
	}
	seen := make(map[int64]struct{}, len(columnIDs))
	for _, id := range columnIDs {
		if id <= 0 {
			return ErrColumnOrder
		}
		if _, exists := seen[id]; exists {
			return ErrColumnOrder
		}
		seen[id] = struct{}{}
	}
	return nil
}

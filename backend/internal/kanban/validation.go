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

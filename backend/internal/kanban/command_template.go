package kanban

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxCommandTemplates    = 50
	maxCommandTemplateName = 60
	maxCommandTemplateBody = 2000
)

var ErrCommandTemplateLimit = errors.New("command template limit")

type CommandTemplate struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Template string `json:"template"`
	Position int    `json:"position"`
}

type CommandTemplateInput struct {
	Name     string `json:"name"`
	Template string `json:"template"`
}

type CommandTemplatePatch struct {
	Name     *string `json:"name"`
	Template *string `json:"template"`
}

func NormalizeCommandTemplateName(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	value := strings.TrimSpace(raw)
	if value == "" || utf8.RuneCountInString(value) > maxCommandTemplateName {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return value, true
}

func NormalizeCommandTemplateBody(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	if raw == "" || utf8.RuneCountInString(raw) > maxCommandTemplateBody {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return raw, true
}

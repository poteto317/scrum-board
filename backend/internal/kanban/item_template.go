package kanban

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxItemTemplateName = 60
	maxItemTemplateTitle = 200
	maxItemTemplateDesc  = 10000
)

type ItemTemplate struct {
	ID                  int64  `json:"id"`
	ProjectID           int64  `json:"projectId"`
	Name                string `json:"name"`
	TitleTemplate       string `json:"titleTemplate"`
	DescriptionTemplate string `json:"descriptionTemplate"`
	Position            int    `json:"position"`
}

type ItemTemplateInput struct {
	Name                string `json:"name"`
	TitleTemplate       string `json:"titleTemplate"`
	DescriptionTemplate string `json:"descriptionTemplate"`
}

type ItemTemplatePatch struct {
	Name                *string `json:"name"`
	TitleTemplate       *string `json:"titleTemplate"`
	DescriptionTemplate *string `json:"descriptionTemplate"`
}

func NormalizeItemTemplateName(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	value := strings.TrimSpace(raw)
	if value == "" || utf8.RuneCountInString(value) > maxItemTemplateName {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return value, true
}

func NormalizeItemTemplateTitle(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	// Keep leading/trailing spaces intentional in seeds (e.g. "[バグ] ").
	if strings.TrimSpace(raw) == "" || utf8.RuneCountInString(raw) > maxItemTemplateTitle {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return raw, true
}

func NormalizeItemTemplateDescription(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	if utf8.RuneCountInString(raw) > maxItemTemplateDesc {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) && r != '\n' && r != '\r' {
			return "", false
		}
	}
	return raw, true
}

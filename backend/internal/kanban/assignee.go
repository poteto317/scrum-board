package kanban

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// PresetAssignees are the fixed agent labels shown as chips.
// Keep in sync with frontend ASSIGNEE_PRESETS (assignee.ts).
var PresetAssignees = []string{"Cursor", "Claude", "Codex", "Antigravity"}

const maxAssigneeLen = 60

// NormalizeAssignee trims input, maps case-insensitive presets to canonical names,
// and accepts other non-empty strings as free text. Empty means unassigned.
// ok is false when the value is invalid (too long or contains control characters).
func NormalizeAssignee(raw string) (value string, ok bool) {
	value = strings.TrimSpace(raw)
	if value == "" {
		return "", true
	}
	if utf8.RuneCountInString(value) > maxAssigneeLen {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	lower := strings.ToLower(value)
	for _, preset := range PresetAssignees {
		if strings.ToLower(preset) == lower {
			return preset, true
		}
	}
	return value, true
}

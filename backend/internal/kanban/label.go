package kanban

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const (
	// MaxWorkspaceLabels caps the labels of the whole workspace (keeps lists and AI prompts small).
	MaxWorkspaceLabels = 200
	// MaxLabelNameRunes is the label name limit in Unicode scalars (the FE uses the same number).
	MaxLabelNameRunes = 40
	// MaxItemLabelInputLen caps the raw labelIds array of POST/PATCH items (before de-duplication).
	MaxItemLabelInputLen = 64
	// MaxItemLabels caps the de-duplicated labels one item may carry.
	MaxItemLabels = 20
	// MaxListFilterLabelIDs caps the raw labelIds array of PUT /api/list-filter.
	MaxListFilterLabelIDs = 64
	// MaxSearchLabelNames caps the labels array of the AI search_items tool.
	MaxSearchLabelNames = 20
)

var (
	ErrLabelDuplicate = errors.New("duplicate label")
	ErrLabelLimit     = errors.New("label limit")
	ErrUnknownLabel   = errors.New("unknown label")
)

// Label is the workspace-wide label definition.
type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// LabelInput is the body of POST /api/labels (already normalized by the handler).
type LabelInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// LabelPatch is a partial update (already normalized by the handler).
type LabelPatch struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

var labelColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func isVariationSelector(r rune) bool {
	return (r >= 0xFE00 && r <= 0xFE0F) || (r >= 0xE0100 && r <= 0xE01EF)
}

// NormalizeLabelName validates and shapes a display name: no control, format or variation
// selector characters; whitespace runs become one space; 1..MaxLabelNameRunes scalars.
func NormalizeLabelName(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	for _, r := range raw {
		// Allow whitespace control runes (e.g. U+0085); strings.Fields below normalizes them to spaces.
		if unicode.IsControl(r) && !unicode.IsSpace(r) {
			return "", false
		}
		if unicode.In(r, unicode.Cf) || isVariationSelector(r) {
			return "", false
		}
	}
	value := strings.Join(strings.Fields(raw), " ")
	if value == "" || utf8.RuneCountInString(value) > MaxLabelNameRunes {
		return "", false
	}
	if LabelNameKey(value) == "" {
		return "", false
	}
	return value, true
}

// LabelNameKey is the identity key of a label name (duplicate check and AI name lookup).
// Order is fixed: drop invisible characters, NFKC, case folding, NFKC again (folding can
// produce decomposable text), then collapse whitespace. It is idempotent.
func LabelNameKey(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (unicode.IsControl(r) && !unicode.IsSpace(r)) || unicode.In(r, unicode.Cf) || isVariationSelector(r) {
			continue
		}
		b.WriteRune(r)
	}
	s := b.String()
	for range 3 {
		s = norm.NFKC.String(s)
		s = cases.Fold().String(s)
	}
	s = norm.NFKC.String(s)
	return strings.Join(strings.Fields(s), " ")
}

// NormalizeLabelColor accepts #rrggbb only and returns it lower-cased.
func NormalizeLabelColor(raw string) (string, bool) {
	v := strings.TrimSpace(raw)
	if !labelColorPattern.MatchString(v) {
		return "", false
	}
	return strings.ToLower(v), true
}

// labelsHistoryJSON is the history value of an item's labels: a JSON array of names.
func labelsHistoryJSON(labels []Label) string {
	names := make([]string, 0, len(labels))
	for _, l := range labels {
		names = append(names, l.Name)
	}
	payload, err := json.Marshal(names)
	if err != nil {
		return "[]"
	}
	return string(payload)
}

func cloneLabels(in []Label) []Label {
	out := make([]Label, len(in))
	copy(out, in)
	return out
}

// dedupeInt64s keeps the first occurrence of each value without filtering (including non-positive ids so callers can reject them).
func dedupeInt64s(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

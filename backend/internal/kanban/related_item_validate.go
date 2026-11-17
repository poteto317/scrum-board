package kanban

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

// ErrRelatedItem is a client validation failure for relatedItems (maps to HTTP 400).
var ErrRelatedItem = errors.New("invalid related item")

const relatedKindItem = "item"
const relatedKindURL = "url"
const relatedLabelMax = 120
const relatedURLMax = 2048

// RelatedItem is one related card or external URL on a card.
type RelatedItem struct {
	Kind      string `json:"kind"`
	Number    int64  `json:"number,omitempty"`
	ProjectID int64  `json:"projectId,omitempty"`
	Title     string `json:"title,omitempty"`
	URL       string `json:"url,omitempty"`
	Label     string `json:"label,omitempty"`
}

// normalizeRelatedItems trims and validates client payloads (no DB). Title is dropped.
// Nil or empty input yields a non-nil empty slice.
func normalizeRelatedItems(items []RelatedItem) ([]RelatedItem, bool) {
	out := make([]RelatedItem, 0, len(items))
	seenItemKeys := map[string]struct{}{}
	seenURLs := map[string]struct{}{}
	for _, raw := range items {
		kind := strings.TrimSpace(raw.Kind)
		label := strings.TrimSpace(raw.Label)
		if len([]rune(label)) > relatedLabelMax {
			return nil, false
		}
		for _, r := range label {
			if unicode.IsControl(r) {
				return nil, false
			}
		}
		switch kind {
		case relatedKindItem:
			if raw.Number <= 0 || raw.ProjectID <= 0 {
				return nil, false
			}
			key := strconv.FormatInt(raw.ProjectID, 10) + ":" + strconv.FormatInt(raw.Number, 10)
			if _, dup := seenItemKeys[key]; dup {
				return nil, false
			}
			seenItemKeys[key] = struct{}{}
			out = append(out, RelatedItem{Kind: relatedKindItem, Number: raw.Number, ProjectID: raw.ProjectID, Label: label})
		case relatedKindURL:
			// Reject before TrimSpace: trailing newlines would otherwise be stripped.
			if strings.ContainsAny(raw.URL, "\r\n") {
				return nil, false
			}
			u := strings.TrimSpace(raw.URL)
			if u == "" || len(u) > relatedURLMax {
				return nil, false
			}
			lower := strings.ToLower(u)
			if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
				return nil, false
			}
			if _, err := url.ParseRequestURI(u); err != nil {
				return nil, false
			}
			if _, dup := seenURLs[u]; dup {
				return nil, false
			}
			seenURLs[u] = struct{}{}
			out = append(out, RelatedItem{Kind: relatedKindURL, URL: u, Label: label})
		default:
			return nil, false
		}
	}
	return out, true
}

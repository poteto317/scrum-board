package kanban

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"
)

// Draft is the caller's rough title and description; both are already trimmed when they reach a CardFormatter.
type Draft struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// RefinedCard is the formatter's result, validated again by the handler before anything is stored.
type RefinedCard struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// CardFormatter turns a draft into a tidy title and description (the AI behind POST /api/cards/refined).
type CardFormatter interface {
	Format(context.Context, Draft) (RefinedCard, error)
}

// FormatFailure lets a formatter report why it failed without exposing upstream text.
type FormatFailure interface {
	error
	FailureKind() string
	UpstreamStatus() int
}

const (
	maxDraftTitleRunes       = 200
	maxDraftDescriptionRunes = 2000
	maxConcurrentFormats     = 4
	// maxAIDuration plus createReserve must stay below RequestTimeout so the AI call can never use the whole request.
	maxAIDuration = 10 * time.Second
	createReserve = 3 * time.Second
	// RequestTimeout is the overall limit the server applies to every request.
	RequestTimeout = 15 * time.Second
)

// normalizeDraft trims the caller's draft and checks the draft rules. A non-empty problem is the 400 message.
func normalizeDraft(d Draft) (Draft, string) {
	d.Title, d.Description = strings.TrimSpace(d.Title), strings.TrimSpace(d.Description)
	if d.Title == "" && d.Description == "" {
		return d, "タイトルか説明のどちらかを入力してください。"
	}
	if utf8.RuneCountInString(d.Title) > maxDraftTitleRunes || utf8.RuneCountInString(d.Description) > maxDraftDescriptionRunes {
		return d, "下書きのタイトルは200文字以内、説明は2000文字以内で入力してください。"
	}
	return d, ""
}

// normalizeRefined applies the storage rules to what the AI returned for a draft: trimmed values, the stored title and
// description limits, no invented description for an empty draft description, and no lost description otherwise.
func normalizeRefined(draft Draft, refined RefinedCard) (RefinedCard, bool) {
	title, description := strings.TrimSpace(refined.Title), strings.TrimSpace(refined.Description)
	if draft.Description == "" {
		description = ""
	} else if description == "" {
		return RefinedCard{}, false
	}
	if !validTitle(title) || !validDescription(description) {
		return RefinedCard{}, false
	}
	return RefinedCard{Title: title, Description: description}, true
}

package main

import (
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/aiformat"
	"scrumboard/internal/kanban"
)

const defaultModel = "claude-haiku-5-5"

// newFormatter returns the Claude-backed formatter, or a nil interface when ANTHROPIC_API_KEY is empty.
// It must return an untyped nil: a typed nil pointer would look configured to the handler.
func newFormatter(getenv func(string) string, opts ...option.RequestOption) kanban.CardFormatter {
	// Secrets often come with a trailing newline; sent as is, the key would fail in the HTTP client with no useful message.
	key := strings.TrimSpace(getenv("ANTHROPIC_API_KEY"))
	if key == "" {
		return nil
	}
	model := strings.TrimSpace(getenv("ANTHROPIC_MODEL"))
	if model == "" {
		model = defaultModel
	}
	return aiformat.New(key, model, opts...)
}

// buildHandler assembles the API handler. The AI endpoint is only wired up when a key is configured; the key is never logged.
func buildHandler(repo kanban.Repository, getenv func(string) string, opts ...option.RequestOption) http.Handler {
	var handlerOpts []kanban.Option
	if formatter := newFormatter(getenv, opts...); formatter != nil {
		handlerOpts = append(handlerOpts, kanban.WithCardFormatter(formatter))
	}
	return http.TimeoutHandler(kanban.NewHandler(repo, handlerOpts...), kanban.RequestTimeout, `{"message":"処理がタイムアウトしました。"}`)
}

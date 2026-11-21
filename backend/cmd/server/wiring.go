package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/aiformat"
	"scrumboard/internal/kanban"
)

const defaultModel = "claude-haiku-5-5"

// newFormatter returns the Claude-backed formatter, or a nil interface when ANTHROPIC_API_KEY is empty.
// It must return an untyped nil: a typed nil pointer would look configured to the handler.
func newFormatter(getenv func(string) string, opts ...option.RequestOption) kanban.ItemFormatter {
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
		handlerOpts = append(handlerOpts, kanban.WithItemFormatter(formatter))
	}
	handlerOpts = append(handlerOpts, kanban.WithPublicOrigin(getenv("PUBLIC_ORIGIN")))
	handlerOpts = append(
		handlerOpts,
		kanban.WithPRTitleResolver(kanban.NewPRTitleResolver(nil, getenv("GITHUB_TOKEN"))),
	)
	handlerOpts = append(handlerOpts, kanban.WithBlobStorage(kanban.NewBlobStorageFromEnv(context.Background(), getenv)))
	inner := kanban.NewHandler(repo, handlerOpts...)
	const timeoutMsg = `{"message":"処理がタイムアウトしました。"}`
	// Attachment upload/content may transfer up to 5 MiB; other routes keep the AI-safe RequestTimeout.
	defaultTO := http.TimeoutHandler(inner, kanban.RequestTimeout, timeoutMsg)
	attachmentTO := http.TimeoutHandler(inner, 60*time.Second, timeoutMsg)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAttachmentHeavyPath(r) {
			attachmentTO.ServeHTTP(w, r)
			return
		}
		defaultTO.ServeHTTP(w, r)
	})
}

func isAttachmentHeavyPath(r *http.Request) bool {
	path := r.URL.Path
	if !strings.Contains(path, "/attachments") {
		return false
	}
	return r.Method == http.MethodPost || r.Method == http.MethodGet || r.Method == http.MethodDelete
}

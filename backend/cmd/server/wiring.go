package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/aichat"
	"scrumboard/internal/aiformat"
	"scrumboard/internal/kanban"
)

const defaultModel = "claude-haiku-5-5"

func anthropicKeyAndModel(getenv func(string) string) (key, model string) {
	// Secrets often come with a trailing newline; sent as is, the key would fail in the HTTP client with no useful message.
	key = strings.TrimSpace(getenv("ANTHROPIC_API_KEY"))
	model = strings.TrimSpace(getenv("ANTHROPIC_MODEL"))
	if model == "" {
		model = defaultModel
	}
	return key, model
}

// newFormatter returns the Claude-backed formatter, or a nil interface when ANTHROPIC_API_KEY is empty.
// It must return an untyped nil: a typed nil pointer would look configured to the handler.
func newFormatter(getenv func(string) string, opts ...option.RequestOption) kanban.ItemFormatter {
	key, model := anthropicKeyAndModel(getenv)
	if key == "" {
		return nil
	}
	return aiformat.New(key, model, opts...)
}

// newChatter returns the Claude-backed chat client, or a nil interface when ANTHROPIC_API_KEY is empty.
// The returned value also implements kanban.ProjectChatter (the tool loop); kanban.WithAIChat
// checks for that and then enables the project chat as well, so one client serves both chats.
func newChatter(getenv func(string) string, maxTokens int64, opts ...option.RequestOption) kanban.ItemChatter {
	key, model := anthropicKeyAndModel(getenv)
	if key == "" {
		return nil
	}
	return aichat.New(key, model, maxTokens, opts...)
}

// buildHandler assembles the API handler. The AI endpoint is only wired up when a key is configured; the key is never logged.
func buildHandler(repo kanban.Repository, getenv func(string) string, opts ...option.RequestOption) http.Handler {
	limits := kanban.ParseAILimits(getenv)
	var handlerOpts []kanban.Option
	if formatter := newFormatter(getenv, opts...); formatter != nil {
		handlerOpts = append(handlerOpts, kanban.WithItemFormatter(formatter))
	}
	if chatter := newChatter(getenv, int64(limits.ChatMaxOutputTokens), opts...); chatter != nil {
		handlerOpts = append(handlerOpts, kanban.WithAIChat(chatter))
	}
	handlerOpts = append(handlerOpts, kanban.WithAILimits(limits))
	handlerOpts = append(handlerOpts, kanban.WithPublicOrigin(getenv("PUBLIC_ORIGIN")))
	handlerOpts = append(handlerOpts, kanban.WithSchedulerJobToken(strings.TrimSpace(getenv("SCHEDULER_JOB_TOKEN"))))
	handlerOpts = append(
		handlerOpts,
		kanban.WithPRTitleResolver(kanban.NewPRTitleResolver(nil, getenv("GITHUB_TOKEN"))),
		kanban.WithLinkPreviewResolver(kanban.NewLinkPreviewResolver()),
	)
	handlerOpts = append(handlerOpts, kanban.WithBlobStorage(kanban.NewBlobStorageFromEnv(context.Background(), getenv)))
	return withRouteTimeouts(kanban.NewHandler(repo, handlerOpts...))
}

// withRouteTimeouts limits every request by its route. Attachment upload/content may transfer
// up to 5 MiB, and the project chat calls the model several times with tool runs in between;
// other routes keep the AI-safe RequestTimeout.
func withRouteTimeouts(inner http.Handler) http.Handler {
	const timeoutMsg = `{"message":"処理がタイムアウトしました。"}`
	defaultTO := http.TimeoutHandler(inner, kanban.RequestTimeout, timeoutMsg)
	attachmentTO := http.TimeoutHandler(inner, 60*time.Second, timeoutMsg)
	projectChatTO := http.TimeoutHandler(inner, kanban.ProjectChatRequestTimeout, timeoutMsg)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case isAttachmentHeavyPath(r):
			attachmentTO.ServeHTTP(w, r)
		case isProjectAIChatPost(r):
			projectChatTO.ServeHTTP(w, r)
		default:
			defaultTO.ServeHTTP(w, r)
		}
	})
}

func isAttachmentHeavyPath(r *http.Request) bool {
	path := r.URL.Path
	if !strings.Contains(path, "/attachments") {
		return false
	}
	return r.Method == http.MethodPost || r.Method == http.MethodGet || r.Method == http.MethodDelete
}

// isProjectAIChatPost matches POST /api/projects/{id}/ai-chat only: reading and clearing the
// history do not call the model and keep the default limit.
func isProjectAIChatPost(r *http.Request) bool {
	if r.Method != http.MethodPost {
		return false
	}
	rest, ok := strings.CutPrefix(r.URL.Path, "/api/projects/")
	if !ok {
		return false
	}
	id, ok := strings.CutSuffix(rest, "/ai-chat")
	return ok && id != "" && !strings.Contains(id, "/")
}

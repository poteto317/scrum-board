// Package aichat talks to Claude for the two chats of the board.
//
//   - Chat (chatter.go) answers a question about one item with a single model call
//     (POST /api/items/by-number/{number}/ai-chat, kanban.ItemChatter).
//   - ChatWithTools (chatter_tools.go) answers a question about a whole project: it calls the
//     model in a loop, running the tools the model asks for in between
//     (POST /api/projects/{id}/ai-chat, kanban.ProjectChatter).
//
// Both turn every model failure into a *Failure without upstream text (failure.go).
package aichat

import (
	"context"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

// Chatter implements kanban.ItemChatter (Chat: one call) and kanban.ProjectChatter
// (ChatWithTools: the tool loop) on top of the official Anthropic SDK. Both use the same
// model, client and output limit; maxTokens applies to each model call.
type Chatter struct {
	model     string
	maxTokens int64
	client    anthropic.Client
}

// New builds a Chatter. The SDK never retries: a retry would outlast the request's own time limit.
// maxTokens < 1 uses kanban.DefaultAIChatMaxOutputTokens.
func New(apiKey, model string, maxTokens int64, opts ...option.RequestOption) *Chatter {
	if maxTokens < 1 {
		maxTokens = int64(kanban.DefaultAIChatMaxOutputTokens)
	}
	all := append([]option.RequestOption{option.WithAPIKey(apiKey), option.WithMaxRetries(0)}, opts...)
	return &Chatter{model: model, maxTokens: maxTokens, client: anthropic.NewClient(all...)}
}

// Chat asks Claude to reply. Every failure becomes a *Failure without upstream text.
func (c *Chatter) Chat(ctx context.Context, system string, messages []kanban.ChatTurn) (string, int64, int64, error) {
	if len(messages) == 0 {
		return "", 0, 0, &Failure{Kind: kindInvalidReq}
	}
	params, ok := turnParams(messages, 0)
	if !ok {
		return "", 0, 0, &Failure{Kind: kindInvalidReq}
	}
	message, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: c.maxTokens,
		System:    []anthropic.TextBlockParam{{Text: system}},
		Messages:  params,
	})
	if err != nil {
		return "", 0, 0, classify(err)
	}
	if message == nil {
		return "", 0, 0, &Failure{Kind: kindInvalidOutput}
	}
	inTok, outTok := message.Usage.InputTokens, message.Usage.OutputTokens
	switch message.StopReason {
	case anthropic.StopReasonEndTurn:
	case anthropic.StopReasonRefusal:
		return "", inTok, outTok, &Failure{Kind: kindRefusal}
	case anthropic.StopReasonMaxTokens:
		return "", inTok, outTok, &Failure{Kind: kindTruncated}
	default:
		return "", inTok, outTok, &Failure{Kind: kindInvalidOutput}
	}
	out := strings.TrimSpace(messageText(message))
	if out == "" {
		return "", inTok, outTok, &Failure{Kind: kindInvalidOutput}
	}
	return out, inTok, outTok, nil
}

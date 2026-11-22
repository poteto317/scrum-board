// Package aichat talks to Claude for item-scoped Q&A (POST .../ai-chat).
package aichat

import (
	"context"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

// Chatter implements kanban.ItemChatter on top of the official Anthropic SDK.
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
	params := make([]anthropic.MessageParam, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case kanban.AIRoleUser:
			params = append(params, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Body)))
		case kanban.AIRoleAssistant:
			params = append(params, anthropic.NewAssistantMessage(anthropic.NewTextBlock(m.Body)))
		default:
			return "", 0, 0, &Failure{Kind: kindInvalidReq}
		}
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
	var text strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	out := strings.TrimSpace(text.String())
	if out == "" {
		return "", inTok, outTok, &Failure{Kind: kindInvalidOutput}
	}
	return out, inTok, outTok, nil
}

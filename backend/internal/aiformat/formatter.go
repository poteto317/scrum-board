// Package aiformat turns a card draft into a tidy title and description with the Claude API.
package aiformat

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

const maxOutputTokens = 8192

// Formatter implements kanban.CardFormatter on top of the official Anthropic SDK.
type Formatter struct {
	model  string
	client anthropic.Client
}

// New builds a Formatter. The SDK never retries: a retry would outlast the request's own time limit.
func New(apiKey, model string, opts ...option.RequestOption) *Formatter {
	all := append([]option.RequestOption{option.WithAPIKey(apiKey), option.WithMaxRetries(0)}, opts...)
	return &Formatter{model: model, client: anthropic.NewClient(all...)}
}

type output struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

// Format asks Claude to tidy the draft. Every failure becomes a *Failure without upstream text.
func (f *Formatter) Format(ctx context.Context, draft kanban.Draft) (kanban.RefinedCard, error) {
	input, err := json.Marshal(draft)
	if err != nil {
		return kanban.RefinedCard{}, &Failure{Kind: kindInvalidOutput}
	}
	message, err := f.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(f.model),
		MaxTokens: maxOutputTokens,
		System:    []anthropic.TextBlockParam{{Text: systemPrompt}},
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(string(input)))},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{Schema: outputSchema},
		},
	})
	if err != nil {
		return kanban.RefinedCard{}, classify(err)
	}
	if message == nil { // a gateway can answer 200 with a JSON null body
		return kanban.RefinedCard{}, &Failure{Kind: kindInvalidOutput}
	}
	switch message.StopReason {
	case anthropic.StopReasonEndTurn:
	case anthropic.StopReasonRefusal:
		return kanban.RefinedCard{}, &Failure{Kind: kindRefusal}
	case anthropic.StopReasonMaxTokens:
		return kanban.RefinedCard{}, &Failure{Kind: kindTruncated}
	default:
		return kanban.RefinedCard{}, &Failure{Kind: kindInvalidOutput}
	}
	var text strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return parse(text.String())
}

func parse(text string) (kanban.RefinedCard, error) {
	var out output
	decoder := json.NewDecoder(bytes.NewReader([]byte(text)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&out); err != nil || out.Title == nil || out.Description == nil {
		return kanban.RefinedCard{}, &Failure{Kind: kindInvalidOutput}
	}
	if _, err := decoder.Token(); err != io.EOF {
		return kanban.RefinedCard{}, &Failure{Kind: kindInvalidOutput}
	}
	return kanban.RefinedCard{Title: *out.Title, Description: *out.Description}, nil
}

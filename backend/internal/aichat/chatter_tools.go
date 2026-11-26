package aichat

import (
	"context"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"scrumboard/internal/kanban"
)

// toolParams turns the kanban tool definitions into SDK tools. Schema keys other than
// type / properties / required are passed through as they are.
func toolParams(tools []kanban.ChatTool) []anthropic.ToolUnionParam {
	out := make([]anthropic.ToolUnionParam, 0, len(tools))
	for _, t := range tools {
		schema := anthropic.ToolInputSchemaParam{}
		for key, value := range t.InputSchema {
			switch key {
			case "type":
				// Always "object": the SDK writes it.
			case "properties":
				schema.Properties = value
			case "required":
				schema.Required = stringList(value)
			default:
				if schema.ExtraFields == nil {
					schema.ExtraFields = map[string]any{}
				}
				schema.ExtraFields[key] = value
			}
		}
		tool := anthropic.ToolParam{Name: t.Name, InputSchema: schema}
		if t.Description != "" {
			tool.Description = anthropic.String(t.Description)
		}
		out = append(out, anthropic.ToolUnionParam{OfTool: &tool})
	}
	return out
}

func stringList(v any) []string {
	switch list := v.(type) {
	case []string:
		return list
	case []any:
		out := make([]string, 0, len(list))
		for _, item := range list {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// usageTotal adds up what the calls of one ChatWithTools used.
type usageTotal struct {
	in, out int64
	// sent is the text of everything sent so far (system, messages, tool results). A call
	// that fails without reported usage is counted by estimating its input from this.
	sent strings.Builder
}

func (u *usageTotal) add(usage anthropic.Usage) {
	u.in += usage.InputTokens
	u.out += usage.OutputTokens
}

// estimateFailedCall counts a call that returned no usage, by the same rule as kanban's estimate.
func (u *usageTotal) estimateFailedCall() {
	in, out := kanban.EstimateAIUsageTokens(u.sent.String())
	u.in += in
	u.out += out
}

// ChatWithTools asks Claude to answer, running the tools it asks for in between.
//
// The model is called at most maxModelCalls times. The last call keeps the tool definitions
// (the conversation contains tool blocks, which the API only accepts with them) but sets
// tool_choice to none, so it has to answer in text. Token counts are the totals over all
// calls. Every model failure becomes a *Failure without upstream text; an error from run is
// returned as it is (it is the caller's own error, not upstream text).
func (c *Chatter) ChatWithTools(ctx context.Context, system string, messages []kanban.ChatTurn, tools []kanban.ChatTool, run kanban.ToolRunner, maxModelCalls int) (string, int64, int64, error) {
	if len(messages) == 0 || maxModelCalls < 1 || (len(tools) > 0 && run == nil) {
		return "", 0, 0, &Failure{Kind: kindInvalidReq}
	}
	params, ok := turnParams(messages, 2*maxModelCalls)
	if !ok {
		return "", 0, 0, &Failure{Kind: kindInvalidReq}
	}
	var total usageTotal
	total.sent.WriteString(system)
	for _, m := range messages {
		total.sent.WriteString(m.Body)
	}
	toolDefs := toolParams(tools)
	for call := 1; call <= maxModelCalls; call++ {
		last := call == maxModelCalls
		request := c.toolLoopRequest(system, params, toolDefs, last)
		message, err := c.client.Messages.New(ctx, request)
		if err != nil {
			total.estimateFailedCall()
			return "", total.in, total.out, classify(err)
		}
		if message == nil {
			total.estimateFailedCall()
			return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
		}
		total.add(message.Usage)
		switch message.StopReason {
		case anthropic.StopReasonEndTurn:
			text := strings.TrimSpace(messageText(message))
			if text == "" {
				return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
			}
			return text, total.in, total.out, nil
		case anthropic.StopReasonToolUse:
			if last {
				// The last call was told not to use tools.
				return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
			}
			results, err := runToolCalls(ctx, message, run, &total)
			if err != nil {
				return "", total.in, total.out, err
			}
			if len(results) == 0 {
				return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
			}
			// The text that came with the tool request is not an answer; the whole turn is
			// sent back unchanged, as the API requires, followed by the results.
			params = append(params, message.ToParam(), anthropic.NewUserMessage(results...))
		case anthropic.StopReasonRefusal:
			return "", total.in, total.out, &Failure{Kind: kindRefusal}
		case anthropic.StopReasonMaxTokens:
			return "", total.in, total.out, &Failure{Kind: kindTruncated}
		default:
			return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
		}
	}
	return "", total.in, total.out, &Failure{Kind: kindInvalidOutput}
}

// turnParams turns the stored conversation into SDK messages, with room for extra more.
// ok is false for a role that is neither user nor assistant.
func turnParams(messages []kanban.ChatTurn, extra int) (params []anthropic.MessageParam, ok bool) {
	params = make([]anthropic.MessageParam, 0, len(messages)+extra)
	for _, m := range messages {
		switch m.Role {
		case kanban.AIRoleUser:
			params = append(params, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Body)))
		case kanban.AIRoleAssistant:
			params = append(params, anthropic.NewAssistantMessage(anthropic.NewTextBlock(m.Body)))
		default:
			return nil, false
		}
	}
	return params, true
}

// toolLoopRequest is the request of one model call of the loop. The last call keeps the tool
// definitions but may not use them (tool_choice none).
func (c *Chatter) toolLoopRequest(system string, params []anthropic.MessageParam, toolDefs []anthropic.ToolUnionParam, last bool) anthropic.MessageNewParams {
	request := anthropic.MessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: c.maxTokens,
		System:    []anthropic.TextBlockParam{{Text: system}},
		Messages:  params,
		Tools:     toolDefs,
	}
	if last && len(toolDefs) > 0 {
		none := anthropic.NewToolChoiceNoneParam()
		request.ToolChoice = anthropic.ToolChoiceUnionParam{OfNone: &none}
	}
	return request
}

// messageText joins the text blocks of a response (other blocks, such as tool requests, are skipped).
func messageText(message *anthropic.Message) string {
	var text strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return text.String()
}

// runToolCalls runs the tool calls of one response in order and returns one tool_result per
// call. Calls beyond kanban.MaxToolCallsPerResponse are not run and get a fixed error result.
// Tool input and output are never logged.
func runToolCalls(ctx context.Context, message *anthropic.Message, run kanban.ToolRunner, total *usageTotal) ([]anthropic.ContentBlockParamUnion, error) {
	var results []anthropic.ContentBlockParamUnion
	ran := 0
	for _, block := range message.Content {
		if block.Type != "tool_use" {
			continue
		}
		if ran >= kanban.MaxToolCallsPerResponse {
			tooMany := kanban.ToolResultTooManyCalls()
			total.sent.WriteString(tooMany)
			results = append(results, anthropic.NewToolResultBlock(block.ID, tooMany, true))
			continue
		}
		ran++
		if run == nil {
			return nil, &Failure{Kind: kindInvalidOutput}
		}
		result, err := run(ctx, kanban.ToolCall{ID: block.ID, Name: block.Name, Input: block.Input})
		if err != nil {
			return nil, err
		}
		total.sent.WriteString(result)
		results = append(results, anthropic.NewToolResultBlock(block.ID, result, false))
	}
	return results, nil
}

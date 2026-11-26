package kanban

import (
	"context"
	"encoding/json"
	"fmt"
)

// ChatTool is one tool the model may ask the server to run.
type ChatTool struct {
	Name        string
	Description string
	InputSchema map[string]any // JSON Schema (type: object)
}

// ToolCall is one tool request from the model.
type ToolCall struct {
	ID    string
	Name  string
	Input json.RawMessage
}

// ToolRunner runs one tool call and returns the text handed back to the model.
// A non-nil err is not shown to the model: the loop stops and the request fails (database failure etc.).
type ToolRunner func(ctx context.Context, call ToolCall) (result string, err error)

// ProjectChatter answers a project-wide question, letting the model call tools before it writes the answer.
//
// It calls the model at most maxModelCalls times; the last call must not use tools. inTok and
// outTok are the totals over every call, including what was spent before a failure. When run
// returns an error, that error is returned as is, with the usage of the calls completed so far.
//
// Estimating is the implementation's job: a call that failed without reported usage must add
// an estimate of its input (EstimateAIUsageTokens over everything sent so far) to the totals.
// The handler also passes its own estimateInput when it records the usage
// (recordProjectChatUsage), but that is only the fallback for an implementation that returns
// a failure with zero tokens; it does not replace the estimate here.
//
// An implementation must also run at most MaxToolCallsPerResponse tool calls of one response
// and answer the rest with ToolResultTooManyCalls(): the tool result budget
// (toolResultBudget) reserves room for exactly that many refusals per round.
type ProjectChatter interface {
	ChatWithTools(ctx context.Context, system string, messages []ChatTurn, tools []ChatTool, run ToolRunner, maxModelCalls int) (text string, inTok, outTok int64, err error)
}

// MaxToolCallsPerResponse is how many tool calls of one model response are run. The rest
// are answered with ToolResultTooManyCalls() without running anything.
const MaxToolCallsPerResponse = 5

// ToolResultTooManyCalls is the result for a tool call beyond MaxToolCallsPerResponse.
func ToolResultTooManyCalls() string {
	return toolErrorResult(fmt.Sprintf("一度に実行できるのは %d 件までです。", MaxToolCallsPerResponse))
}

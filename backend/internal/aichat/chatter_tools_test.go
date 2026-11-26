package aichat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

// scriptedAnthropic answers each request with the next scripted handler and keeps every request body.
type scriptedAnthropic struct {
	srv    *httptest.Server
	mu     sync.Mutex
	bodies []map[string]any
}

func newScripted(t *testing.T, steps ...func(http.ResponseWriter, *http.Request)) *scriptedAnthropic {
	t.Helper()
	isolate(t)
	s := &scriptedAnthropic{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		s.mu.Lock()
		index := len(s.bodies)
		s.bodies = append(s.bodies, body)
		s.mu.Unlock()
		if index >= len(steps) {
			index = len(steps) - 1 // the last step repeats
		}
		steps[index](w, r)
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *scriptedAnthropic) chatter() *Chatter {
	return New(secretKey, "claude-haiku-5-5", 0, option.WithBaseURL(s.srv.URL))
}

func (s *scriptedAnthropic) requests() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.bodies...)
}

type toolUse struct {
	id, name, input string
}

// toolUseJSON is a model response that asks for tools (with some text before them).
func toolUseJSON(uses ...toolUse) string {
	content := []map[string]any{{"type": "text", "text": "調べます"}}
	for _, u := range uses {
		content = append(content, map[string]any{"type": "tool_use", "id": u.id, "name": u.name, "input": json.RawMessage(u.input)})
	}
	body, _ := json.Marshal(map[string]any{
		"id": "msg_tool", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
		"content": content, "stop_reason": "tool_use", "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 11, "output_tokens": 22},
	})
	return string(body)
}

var testTools = []kanban.ChatTool{
	{Name: "search_items", Description: "検索する", InputSchema: map[string]any{
		"type":       "object",
		"properties": map[string]any{"query": map[string]any{"type": "string"}},
	}},
	{Name: "get_item", Description: "開く", InputSchema: map[string]any{
		"type":       "object",
		"properties": map[string]any{"number": map[string]any{"type": "integer"}},
		"required":   []string{"number"},
	}},
}

func chatWithTools(c *Chatter, run kanban.ToolRunner, maxCalls int) (string, int64, int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c.ChatWithTools(ctx, "SYSTEM", []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "期限が近いものは？"}}, testTools, run, maxCalls)
}

func blocksOf(t *testing.T, message any) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, b := range message.(map[string]any)["content"].([]any) {
		out = append(out, b.(map[string]any))
	}
	return out
}

func toolResultText(block map[string]any) string {
	var text strings.Builder
	for _, c := range block["content"].([]any) {
		text.WriteString(c.(map[string]any)["text"].(string))
	}
	return text.String()
}

func TestChatWithToolsRunsToolAndReturnsFinalText(t *testing.T) {
	s := newScripted(t,
		reply(200, toolUseJSON(toolUse{"toolu_1", "search_items", `{"query":"認証"}`})),
		reply(200, messageJSON("end_turn", "#12 認証 が該当します")),
	)
	var calls []kanban.ToolCall
	text, inTok, outTok, err := chatWithTools(s.chatter(), func(_ context.Context, call kanban.ToolCall) (string, error) {
		calls = append(calls, call)
		return `{"total":1}`, nil
	}, 4)
	if err != nil || text != "#12 認証 が該当します" {
		t.Fatalf("text=%q err=%v", text, err)
	}
	if inTok != 22 || outTok != 44 {
		t.Fatalf("tokens must be the sum over both calls: %d %d", inTok, outTok)
	}
	if len(calls) != 1 || calls[0].ID != "toolu_1" || calls[0].Name != "search_items" || !strings.Contains(string(calls[0].Input), "認証") {
		t.Fatalf("runner calls=%+v", calls)
	}
	reqs := s.requests()
	if len(reqs) != 2 {
		t.Fatalf("requests=%d", len(reqs))
	}
	tools := reqs[0]["tools"].([]any)
	if len(tools) != 2 {
		t.Fatalf("tools=%v", tools)
	}
	first := tools[0].(map[string]any)
	schema := first["input_schema"].(map[string]any)
	if first["name"] != "search_items" || first["description"] != "検索する" || schema["type"] != "object" || schema["properties"].(map[string]any)["query"] == nil {
		t.Fatalf("tool definition=%v", first)
	}
	if required := tools[1].(map[string]any)["input_schema"].(map[string]any)["required"].([]any); len(required) != 1 || required[0] != "number" {
		t.Fatalf("required=%v", required)
	}
	if _, set := reqs[0]["tool_choice"]; set {
		t.Fatalf("the first call must leave tool_choice unset: %v", reqs[0]["tool_choice"])
	}
	// 2 回目: ユーザー → アシスタント（tool_use をそのまま）→ ユーザー（tool_result）。
	messages := reqs[1]["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("messages=%v", messages)
	}
	var echoed map[string]any
	for _, b := range blocksOf(t, messages[1]) {
		if b["type"] == "tool_use" {
			echoed = b
		}
	}
	if messages[1].(map[string]any)["role"] != "assistant" || echoed == nil || echoed["id"] != "toolu_1" || echoed["name"] != "search_items" {
		t.Fatalf("assistant turn must be echoed with its tool_use: %v", messages[1])
	}
	results := blocksOf(t, messages[2])
	if messages[2].(map[string]any)["role"] != "user" || len(results) != 1 || results[0]["type"] != "tool_result" ||
		results[0]["tool_use_id"] != "toolu_1" || toolResultText(results[0]) != `{"total":1}` {
		t.Fatalf("tool result=%v", messages[2])
	}
}

func TestChatWithToolsLastCallForbidsTools(t *testing.T) {
	// モデルがツールを求め続けても、呼び出しは 4 回まで。4 回目は tool_choice が none。
	s := newScripted(t, reply(200, toolUseJSON(toolUse{"toolu_x", "get_item", `{"number":1}`})))
	ran := 0
	_, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) {
		ran++
		return "{}", nil
	}, 4)
	if err == nil {
		t.Fatal("a tool request on the last call must fail")
	}
	if kind, _ := kindOf(t, err); kind != "invalid_output" {
		t.Fatalf("kind=%s", kind)
	}
	reqs := s.requests()
	if len(reqs) != 4 || ran != 3 {
		t.Fatalf("requests=%d tool runs=%d", len(reqs), ran)
	}
	if inTok != 44 || outTok != 88 {
		t.Fatalf("tokens=%d %d", inTok, outTok)
	}
	for i, req := range reqs {
		choice, set := req["tool_choice"]
		if i < 3 && set {
			t.Fatalf("call %d must not set tool_choice: %v", i+1, choice)
		}
		if i == 3 {
			if !set || choice.(map[string]any)["type"] != "none" {
				t.Fatalf("the last call must set tool_choice none: %v", choice)
			}
			if tools, ok := req["tools"].([]any); !ok || len(tools) != 2 {
				t.Fatalf("the last call must keep the tool definitions: %v", req["tools"])
			}
		}
	}
}

func TestChatWithToolsAnswersOnTheLastCall(t *testing.T) {
	use := reply(200, toolUseJSON(toolUse{"toolu_x", "get_item", `{"number":1}`}))
	s := newScripted(t, use, use, use, reply(200, messageJSON("end_turn", "まとめ")))
	text, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) { return "{}", nil }, 4)
	if err != nil || text != "まとめ" || inTok != 44 || outTok != 88 || len(s.requests()) != 4 {
		t.Fatalf("text=%q in=%d out=%d err=%v requests=%d", text, inTok, outTok, err, len(s.requests()))
	}
}

func TestChatWithToolsRunsAtMostFiveToolsPerResponse(t *testing.T) {
	var uses []toolUse
	for _, id := range []string{"t1", "t2", "t3", "t4", "t5", "t6", "t7"} {
		uses = append(uses, toolUse{id, "get_item", `{"number":1}`})
	}
	s := newScripted(t, reply(200, toolUseJSON(uses...)), reply(200, messageJSON("end_turn", "ok")))
	var ran []string
	if _, _, _, err := chatWithTools(s.chatter(), func(_ context.Context, call kanban.ToolCall) (string, error) {
		ran = append(ran, call.ID)
		return `{"ok":true}`, nil
	}, 4); err != nil {
		t.Fatal(err)
	}
	if strings.Join(ran, ",") != "t1,t2,t3,t4,t5" {
		t.Fatalf("only the first 5 run, in order: %v", ran)
	}
	results := blocksOf(t, s.requests()[1]["messages"].([]any)[2])
	if len(results) != 7 {
		t.Fatalf("every tool_use needs a tool_result: %d", len(results))
	}
	for i, r := range results {
		over := i >= 5
		if isErr, _ := r["is_error"].(bool); isErr != over {
			t.Fatalf("result %d is_error=%v", i, r["is_error"])
		}
		if over && toolResultText(r) != kanban.ToolResultTooManyCalls() {
			t.Fatalf("result %d=%q", i, toolResultText(r))
		}
	}
	if !strings.Contains(kanban.ToolResultTooManyCalls(), "一度に実行できるのは 5 件までです") {
		t.Fatalf("fixed text=%q", kanban.ToolResultTooManyCalls())
	}
}

func TestChatWithToolsLaterFailureKeepsUsageAndEstimatesTheFailedCall(t *testing.T) {
	const result = "RESULT-0123456789"
	s := newScripted(t,
		reply(200, toolUseJSON(toolUse{"toolu_1", "search_items", `{}`})),
		reply(500, errorJSON("api_error")),
	)
	_, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) { return result, nil }, 4)
	if err == nil {
		t.Fatal("accepted")
	}
	if kind, status := kindOf(t, err); kind != "server" || status != 500 {
		t.Fatalf("kind=%s status=%d", kind, status)
	}
	assertNoLeak(t, "second call 500", err)
	// 1 回目の実数（11 / 22）に、2 回目に送った内容（システム + メッセージ + ツールの結果）の見積もりを足す。
	estimate, _ := kanban.EstimateAIUsageTokens("SYSTEM" + "期限が近いものは？" + result)
	if inTok != 11+estimate || outTok != 22 {
		t.Fatalf("in=%d (want %d) out=%d", inTok, 11+estimate, outTok)
	}
}

func TestChatWithToolsTimeoutOnLaterCallIsCounted(t *testing.T) {
	release := make(chan struct{})
	s := newScripted(t,
		reply(200, toolUseJSON(toolUse{"toolu_1", "search_items", `{}`})),
		func(http.ResponseWriter, *http.Request) { <-release },
	)
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	_, inTok, outTok, err := s.chatter().ChatWithTools(ctx, "SYSTEM", []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}}, testTools,
		func(context.Context, kanban.ToolCall) (string, error) { return "{}", nil }, 4)
	if err == nil {
		t.Fatal("accepted")
	}
	if kind, _ := kindOf(t, err); kind != "timeout" {
		t.Fatalf("kind=%s", kind)
	}
	if inTok <= 11 || outTok != 22 {
		t.Fatalf("the timed-out call must be estimated on top of the first call: in=%d out=%d", inTok, outTok)
	}
}

func TestChatWithToolsFirstCallFailureIsEstimated(t *testing.T) {
	s := newScripted(t, reply(429, errorJSON("rate_limit_error")))
	_, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) { return "{}", nil }, 4)
	if kind, status := kindOf(t, err); kind != "rate_limit" || status != 429 {
		t.Fatalf("kind=%s status=%d", kind, status)
	}
	estimate, _ := kanban.EstimateAIUsageTokens("SYSTEM" + "期限が近いものは？")
	if inTok != estimate || outTok != 0 {
		t.Fatalf("in=%d want %d out=%d", inTok, estimate, outTok)
	}
	assertNoLeak(t, "first call 429", err)
}

func TestChatWithToolsRunnerErrorStopsTheLoop(t *testing.T) {
	s := newScripted(t,
		reply(200, toolUseJSON(toolUse{"toolu_1", "search_items", `{}`}, toolUse{"toolu_2", "get_item", `{"number":1}`})),
		reply(200, messageJSON("end_turn", "must not be reached")),
	)
	boom := errors.New("db down")
	ran := 0
	text, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) {
		ran++
		return "", boom
	}, 4)
	if !errors.Is(err, boom) || text != "" {
		t.Fatalf("the runner's error must come back as is: text=%q err=%v", text, err)
	}
	if ran != 1 || len(s.requests()) != 1 {
		t.Fatalf("the loop must stop at the first failed tool: runs=%d requests=%d", ran, len(s.requests()))
	}
	if inTok != 11 || outTok != 22 {
		t.Fatalf("only the usage of the completed call is returned: %d %d", inTok, outTok)
	}
}

func TestChatWithToolsStopReasonsAfterATool(t *testing.T) {
	cases := []struct{ name, stop, text, kind string }{
		{"refusal", "refusal", "no", "refusal"},
		{"max_tokens", "max_tokens", "partial", "truncated"},
		{"empty", "end_turn", "  ", "invalid_output"},
		{"pause", "pause_turn", "x", "invalid_output"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newScripted(t,
				reply(200, toolUseJSON(toolUse{"toolu_1", "search_items", `{}`})),
				reply(200, messageJSON(tc.stop, tc.text)),
			)
			_, inTok, outTok, err := chatWithTools(s.chatter(), func(context.Context, kanban.ToolCall) (string, error) { return "{}", nil }, 4)
			if err == nil {
				t.Fatal("accepted")
			}
			if kind, _ := kindOf(t, err); kind != tc.kind || inTok != 22 || outTok != 44 {
				t.Fatalf("kind=%s in=%d out=%d", kind, inTok, outTok)
			}
		})
	}
}

func TestChatWithToolsRejectsBadCallsLocally(t *testing.T) {
	s := newScripted(t, reply(200, messageJSON("end_turn", "x")))
	run := func(context.Context, kanban.ToolCall) (string, error) { return "{}", nil }
	user := []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}}
	cases := map[string]func() error{
		"no messages": func() error {
			_, _, _, err := s.chatter().ChatWithTools(context.Background(), "s", nil, testTools, run, 4)
			return err
		},
		"no calls allowed": func() error {
			_, _, _, err := s.chatter().ChatWithTools(context.Background(), "s", user, testTools, run, 0)
			return err
		},
		"unknown role": func() error {
			_, _, _, err := s.chatter().ChatWithTools(context.Background(), "s", []kanban.ChatTurn{{Role: "system", Body: "q"}}, testTools, run, 4)
			return err
		},
		"tools without runner": func() error {
			_, _, _, err := s.chatter().ChatWithTools(context.Background(), "s", user, testTools, nil, 4)
			return err
		},
	}
	for name, call := range cases {
		err := call()
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
		if kind, status := kindOf(t, err); kind != "invalid_request" || status != 0 {
			t.Fatalf("%s: kind=%s status=%d", name, kind, status)
		}
	}
	if n := len(s.requests()); n != 0 {
		t.Fatalf("nothing may be sent: %d", n)
	}
}

func TestChatterImplementsBothKanbanInterfaces(t *testing.T) {
	var c any = New(secretKey, "claude-haiku-5-5", 0)
	if _, ok := c.(kanban.ItemChatter); !ok {
		t.Fatal("ItemChatter")
	}
	if _, ok := c.(kanban.ProjectChatter); !ok {
		t.Fatal("ProjectChatter")
	}
}

func TestTurnParamsKeepsOrderAndRejectsUnknownRoles(t *testing.T) {
	params, ok := turnParams([]kanban.ChatTurn{
		{Role: kanban.AIRoleUser, Body: "q1"}, {Role: kanban.AIRoleAssistant, Body: "a1"}, {Role: kanban.AIRoleUser, Body: "q2"},
	}, 4)
	if !ok || len(params) != 3 || cap(params) < 7 {
		t.Fatalf("ok=%v len=%d cap=%d", ok, len(params), cap(params))
	}
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	var sent []struct {
		Role    string `json:"role"`
		Content []struct {
			Type, Text string
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &sent); err != nil {
		t.Fatal(err)
	}
	for i, want := range []struct{ role, text string }{{"user", "q1"}, {"assistant", "a1"}, {"user", "q2"}} {
		if sent[i].Role != want.role || len(sent[i].Content) != 1 || sent[i].Content[0].Text != want.text {
			t.Fatalf("message %d=%+v", i, sent[i])
		}
	}
	if _, ok := turnParams([]kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}, {Role: "system", Body: "x"}}, 0); ok {
		t.Fatal("an unknown role must be rejected")
	}
}

// 最後の 1 回だけ tool_choice を none にする。ツールの定義は渡したまま。ツールが無ければ付けない。
func TestToolLoopRequestForbidsToolsOnlyOnTheLastCall(t *testing.T) {
	c := New("k", "model-x", 123)
	params, _ := turnParams([]kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}}, 0)
	defs := toolParams([]kanban.ChatTool{{Name: "search_items", InputSchema: map[string]any{"type": "object"}}})
	body := func(defs []anthropic.ToolUnionParam, last bool) map[string]any {
		raw, err := json.Marshal(c.toolLoopRequest("sys", params, defs, last))
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	first := body(defs, false)
	if first["model"] != "model-x" || first["max_tokens"] != float64(123) || len(first["tools"].([]any)) != 1 {
		t.Fatalf("first=%v", first)
	}
	if _, has := first["tool_choice"]; has {
		t.Fatalf("tools must be allowed before the last call: %v", first["tool_choice"])
	}
	last := body(defs, true)
	if choice, _ := last["tool_choice"].(map[string]any); choice["type"] != "none" || len(last["tools"].([]any)) != 1 {
		t.Fatalf("last=%v", last)
	}
	if _, has := body(nil, true)["tool_choice"]; has {
		t.Fatal("without tools there is nothing to forbid")
	}
}

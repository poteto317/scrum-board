package aiformat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

const (
	secretKey   = "SENTINEL-KEY-sk-ant-123"
	secretDraft = "SENTINEL-DRAFT-body"
	secretReply = "SENTINEL-UPSTREAM-body"
)

// isolate keeps a developer's own ANTHROPIC_* settings from changing what the tests send.
func isolate(t *testing.T) {
	t.Helper()
	for _, name := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_PROFILE", "ANTHROPIC_CUSTOM_HEADERS"} {
		t.Setenv(name, "")
	}
}

func messageBlocksJSON(stopReason string, blocks ...map[string]any) string {
	if blocks == nil {
		blocks = []map[string]any{}
	}
	body, _ := json.Marshal(map[string]any{
		"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
		"content": blocks, "stop_reason": stopReason, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 10},
	})
	return string(body)
}

func messageJSON(stopReason string, texts ...string) string {
	blocks := make([]map[string]any, 0, len(texts))
	for _, text := range texts {
		blocks = append(blocks, map[string]any{"type": "text", "text": text})
	}
	return messageBlocksJSON(stopReason, blocks...)
}

func answer(title, description string) string {
	body, _ := json.Marshal(map[string]string{"title": title, "description": description})
	return messageJSON("end_turn", string(body))
}

// fakeAnthropic serves one canned reply and records what the SDK sent.
type fakeAnthropic struct {
	srv      *httptest.Server
	requests atomic.Int32
	path     string
	header   http.Header
	body     map[string]any
}

func newFake(t *testing.T, handler func(w http.ResponseWriter, r *http.Request)) *fakeAnthropic {
	t.Helper()
	isolate(t)
	f := &fakeAnthropic{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests.Add(1)
		f.path, f.header = r.URL.Path, r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &f.body)
		handler(w, r)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func reply(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

func (f *fakeAnthropic) formatter() *Formatter {
	return New(secretKey, "claude-haiku-5-5", option.WithBaseURL(f.srv.URL))
}

func format(f *Formatter, draft kanban.Draft) (kanban.RefinedCard, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return f.Format(ctx, draft)
}

func kindOf(t *testing.T, err error) (string, int) {
	t.Helper()
	var failure *Failure
	if !errors.As(err, &failure) {
		t.Fatalf("error is not a *Failure: %T %v", err, err)
	}
	return failure.Kind, failure.Status
}

func assertNoLeak(t *testing.T, label string, err error) {
	t.Helper()
	for _, text := range []string{err.Error(), fmt.Sprintf("%v", err), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
		for _, secret := range []string{secretKey, secretDraft, secretReply} {
			if strings.Contains(text, secret) {
				t.Fatalf("%s: error text leaked %q: %s", label, secret, text)
			}
		}
	}
	if errors.Unwrap(err) != nil {
		t.Fatalf("%s: the upstream error must not be wrapped", label)
	}
}

func TestFormatSendsTheExpectedRequest(t *testing.T) {
	f := newFake(t, reply(200, answer("整えた題名", "整えた説明")))
	got, err := format(f.formatter(), kanban.Draft{Title: "下書き題名", Description: "下書き説明"})
	if err != nil || got != (kanban.RefinedCard{Title: "整えた題名", Description: "整えた説明"}) {
		t.Fatalf("got %+v %v", got, err)
	}
	if f.path != "/v1/messages" || f.requests.Load() != 1 {
		t.Fatalf("path=%s requests=%d", f.path, f.requests.Load())
	}
	auth := f.header.Get("Authorization") + f.header.Get("X-Api-Key")
	if !strings.Contains(auth, secretKey) || f.header.Get("Anthropic-Version") == "" {
		t.Fatalf("headers=%v", f.header)
	}
	if f.body["model"] != "claude-haiku-5-5" || f.body["max_tokens"] != float64(8192) {
		t.Fatalf("body=%v", f.body)
	}
	for _, key := range []string{"temperature", "top_p", "top_k", "thinking", "tools", "tool_choice", "stream"} {
		if _, present := f.body[key]; present {
			t.Fatalf("%q must not be sent: %v", key, f.body)
		}
	}
	config := f.body["output_config"].(map[string]any)
	format := config["format"].(map[string]any)
	schema := format["schema"].(map[string]any)
	props := schema["properties"].(map[string]any)
	if config["effort"] != "low" || format["type"] != "json_schema" || schema["type"] != "object" || schema["additionalProperties"] != false {
		t.Fatalf("output_config=%v", config)
	}
	if props["title"].(map[string]any)["type"] != "string" || props["description"].(map[string]any)["type"] != "string" || len(schema["required"].([]any)) != 2 {
		t.Fatalf("schema=%v", schema)
	}
	system := f.body["system"].([]any)[0].(map[string]any)
	if system["type"] != "text" || strings.TrimSpace(system["text"].(string)) == "" {
		t.Fatalf("system=%v", f.body["system"])
	}
	messages := f.body["messages"].([]any)
	if len(messages) != 1 || messages[0].(map[string]any)["role"] != "user" {
		t.Fatalf("messages=%v", messages)
	}
	var sent kanban.Draft
	text := messages[0].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	if json.Unmarshal([]byte(text), &sent) != nil || sent != (kanban.Draft{Title: "下書き題名", Description: "下書き説明"}) {
		t.Fatalf("the draft must be sent as JSON, got %q", text)
	}
}

func TestFormatReadsAllTextBlocksAsOneJSONDocument(t *testing.T) {
	cases := map[string]string{
		"multiple text blocks": messageJSON("end_turn", `{"title":"題`, `名","description":"説明"}`),
		"skips non-text blocks before and between text blocks": messageBlocksJSON(
			"end_turn",
			map[string]any{"type": "thinking", "thinking": "下書きを整える手順を考える", "signature": "sig_test"},
			map[string]any{"type": "text", "text": `{"title":"題`},
			map[string]any{"type": "thinking", "thinking": "補足", "signature": "sig_test2"},
			map[string]any{"type": "text", "text": `名","description":"説明"}`},
		),
	}
	for name, body := range cases {
		f := newFake(t, reply(200, body))
		got, err := format(f.formatter(), kanban.Draft{Title: "x"})
		if err != nil || got.Title != "題名" || got.Description != "説明" {
			t.Fatalf("%s: got %+v %v", name, got, err)
		}
	}
}

func TestFormatRejectsOutputThatIsNotTheExpectedJSON(t *testing.T) {
	for name, body := range map[string]string{
		"not JSON":         messageJSON("end_turn", "整えました"),
		"unknown key":      messageJSON("end_turn", `{"title":"a","description":"b","extra":"c"}`),
		"missing title":    messageJSON("end_turn", `{"description":"b"}`),
		"missing desc":     messageJSON("end_turn", `{"title":"a"}`),
		"wrong type":       messageJSON("end_turn", `{"title":1,"description":"b"}`),
		"trailing data":    messageJSON("end_turn", `{"title":"a","description":"b"} {}`),
		"no text blocks":   messageJSON("end_turn"),
		"array":            messageJSON("end_turn", `[]`),
		"garbled response": `<html>` + secretReply,
	} {
		f := newFake(t, reply(200, body))
		_, err := format(f.formatter(), kanban.Draft{Title: secretDraft})
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
		if kind, _ := kindOf(t, err); kind != "invalid_output" {
			t.Fatalf("%s: kind=%s", name, kind)
		}
		assertNoLeak(t, name, err)
	}
}

func TestFormatClassifiesStopReasonsAndHTTPStatuses(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
		kind   string
	}{
		"refusal":        {200, messageJSON("refusal", `{"title":"a","description":"b"}`), "refusal"},
		"max tokens":     {200, messageJSON("max_tokens", `{"title":"a","description":"b"}`), "truncated"},
		"tool use":       {200, messageJSON("tool_use", `{"title":"a","description":"b"}`), "invalid_output"},
		"pause turn":     {200, messageJSON("pause_turn", `{"title":"a","description":"b"}`), "invalid_output"},
		"unauthorized":   {401, errorJSON("authentication_error"), "auth"},
		"forbidden":      {403, errorJSON("permission_error"), "auth"},
		"rate limited":   {429, errorJSON("rate_limit_error"), "rate_limit"},
		"bad request":    {400, errorJSON("invalid_request_error"), "invalid_request"},
		"unknown model":  {404, errorJSON("not_found_error"), "invalid_request"},
		"too large":      {413, errorJSON("request_too_large"), "invalid_request"},
		"server error":   {500, errorJSON("api_error"), "server"},
		"overloaded":     {529, errorJSON("overloaded_error"), "server"},
		"bad gateway":    {502, secretReply, "server"},
		"empty error":    {500, ``, "server"},
		"broken success": {200, `{"content":`, "invalid_output"},
	} {
		f := newFake(t, reply(tc.status, tc.body))
		_, err := format(f.formatter(), kanban.Draft{Title: secretDraft})
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
		kind, status := kindOf(t, err)
		if kind != tc.kind {
			t.Fatalf("%s: kind=%s, want %s", name, kind, tc.kind)
		}
		if tc.status >= 400 && status != tc.status {
			t.Fatalf("%s: status=%d, want %d", name, status, tc.status)
		}
		if f.requests.Load() != 1 {
			t.Fatalf("%s: %d requests; retries must be off", name, f.requests.Load())
		}
		assertNoLeak(t, name, err)
	}
}

func errorJSON(kind string) string {
	return fmt.Sprintf(`{"type":"error","error":{"type":%q,"message":%q}}`, kind, secretReply+" "+secretKey+" "+secretDraft)
}

func TestFormatReportsConnectionFailures(t *testing.T) {
	f := newFake(t, reply(200, answer("a", "b")))
	formatter := f.formatter()
	f.srv.Close()
	_, err := format(formatter, kanban.Draft{Title: secretDraft})
	if err == nil {
		t.Fatal("accepted")
	}
	if kind, _ := kindOf(t, err); kind != "connect" {
		t.Fatalf("kind=%s", kind)
	}
	assertNoLeak(t, "connect", err)
}

func TestFormatStopsWhenTheServerStalls(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	stall := func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}
	stallBody := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", "100000")
		w.WriteHeader(200)
		_, _ = io.WriteString(w, `{"id":"msg_`)
		w.(http.Flusher).Flush()
		stall(w, r)
	}
	for name, handler := range map[string]func(http.ResponseWriter, *http.Request){"no response": stall, "body stops": stallBody} {
		f := newFake(t, handler)
		ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
		start := time.Now()
		_, err := f.formatter().Format(ctx, kanban.Draft{Title: secretDraft})
		cancel()
		if err == nil || time.Since(start) > 3*time.Second {
			t.Fatalf("%s: err=%v after %v", name, err, time.Since(start))
		}
		if kind, _ := kindOf(t, err); kind != "timeout" {
			t.Fatalf("%s: kind=%s", name, kind)
		}
		assertNoLeak(t, name, err)
	}
	f := newFake(t, stall)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := f.formatter().Format(ctx, kanban.Draft{Title: "x"})
	if err == nil {
		t.Fatal("canceled context accepted")
	}
	if kind, _ := kindOf(t, err); kind != "timeout" {
		t.Fatalf("canceled: kind=%s", kind)
	}
}

func TestFormatReportsATruncatedBodyAsInvalidOutput(t *testing.T) {
	f := newFake(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", "5000")
		w.WriteHeader(200)
		_, _ = io.WriteString(w, `{"id":"msg_`+secretReply)
	})
	_, err := format(f.formatter(), kanban.Draft{Title: secretDraft})
	if err == nil {
		t.Fatal("accepted")
	}
	if kind, _ := kindOf(t, err); kind != "invalid_output" {
		t.Fatalf("kind=%s", kind)
	}
	assertNoLeak(t, "truncated", err)
}

func TestFailureNeverCarriesUpstreamText(t *testing.T) {
	err := error(&Failure{Kind: "server", Status: 500})
	if err.Error() != "ai formatting failed: server" {
		t.Fatalf("message=%q", err.Error())
	}
	var failure kanban.FormatFailure
	if !errors.As(err, &failure) || failure.FailureKind() != "server" || failure.UpstreamStatus() != 500 {
		t.Fatalf("Failure must satisfy kanban.FormatFailure")
	}
}

func TestFormatTreatsANullResponseBodyAsInvalidOutput(t *testing.T) {
	f := newFake(t, reply(200, `null`))
	_, err := format(f.formatter(), kanban.Draft{Title: secretDraft})
	if err == nil {
		t.Fatal("accepted")
	}
	if kind, _ := kindOf(t, err); kind != "invalid_output" {
		t.Fatalf("kind=%s", kind)
	}
	assertNoLeak(t, "null body", err)
}

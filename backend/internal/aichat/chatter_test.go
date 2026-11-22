package aichat

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
	secretKey   = "SENTINEL-NOT-A-REAL-API-KEY"
	secretMsg   = "SENTINEL-CHAT-body"
	secretReply = "SENTINEL-UPSTREAM-body"
)

func isolate(t *testing.T) {
	t.Helper()
	for _, name := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_PROFILE", "ANTHROPIC_CUSTOM_HEADERS"} {
		t.Setenv(name, "")
	}
}

func messageJSON(stopReason, text string) string {
	body, _ := json.Marshal(map[string]any{
		"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
		"content": []map[string]any{{"type": "text", "text": text}}, "stop_reason": stopReason, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 11, "output_tokens": 22},
	})
	return string(body)
}

func errorJSON(kind string) string {
	return fmt.Sprintf(`{"type":"error","error":{"type":%q,"message":%q}}`, kind, secretReply+" "+secretKey+" "+secretMsg)
}

type fakeAnthropic struct {
	srv      *httptest.Server
	requests atomic.Int32
	path     string
	body     map[string]any
}

func newFake(t *testing.T, handler func(w http.ResponseWriter, r *http.Request)) *fakeAnthropic {
	t.Helper()
	isolate(t)
	f := &fakeAnthropic{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests.Add(1)
		f.path = r.URL.Path
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

func (f *fakeAnthropic) chatter() *Chatter {
	return New(secretKey, "claude-haiku-5-5", 0, option.WithBaseURL(f.srv.URL))
}

func chat(c *Chatter, system string, msgs []kanban.ChatTurn) (string, int64, int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c.Chat(ctx, system, msgs)
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
		for _, secret := range []string{secretKey, secretMsg, secretReply} {
			if strings.Contains(text, secret) {
				t.Fatalf("%s: error text leaked %q: %s", label, secret, text)
			}
		}
	}
	if errors.Unwrap(err) != nil {
		t.Fatalf("%s: the upstream error must not be wrapped", label)
	}
}

func TestChatSuccessIncludesSystemAndMessages(t *testing.T) {
	f := newFake(t, reply(200, messageJSON("end_turn", "こんにちは")))
	text, inTok, outTok, err := chat(f.chatter(), "system with TITLE-MARKER", []kanban.ChatTurn{
		{Role: kanban.AIRoleUser, Body: "質問です"},
	})
	if err != nil || text != "こんにちは" || inTok != 11 || outTok != 22 {
		t.Fatalf("got %q %d %d %v", text, inTok, outTok, err)
	}
	if f.path != "/v1/messages" || f.requests.Load() != 1 {
		t.Fatalf("path=%s requests=%d", f.path, f.requests.Load())
	}
	system := f.body["system"].([]any)[0].(map[string]any)
	if !strings.Contains(system["text"].(string), "TITLE-MARKER") {
		t.Fatalf("system must include title context: %v", f.body["system"])
	}
	messages := f.body["messages"].([]any)
	if len(messages) != 1 || messages[0].(map[string]any)["role"] != "user" {
		t.Fatalf("messages=%v", messages)
	}
	if int(f.body["max_tokens"].(float64)) != 4096 {
		t.Fatalf("default max_tokens=%v", f.body["max_tokens"])
	}
}

func TestChatCustomMaxTokens(t *testing.T) {
	f := newFake(t, reply(200, messageJSON("end_turn", "hi")))
	c := New(secretKey, "claude-haiku-5-5", 2048, option.WithBaseURL(f.srv.URL))
	if _, _, _, err := chat(c, "sys", []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}}); err != nil {
		t.Fatal(err)
	}
	if int(f.body["max_tokens"].(float64)) != 2048 {
		t.Fatalf("max_tokens=%v", f.body["max_tokens"])
	}
}

func TestChatStopReasonsReturnUsage(t *testing.T) {
	cases := []struct {
		name, stop, kind string
		text             string
	}{
		{"max_tokens", "max_tokens", "truncated", "partial"},
		{"refusal", "refusal", "refusal", "nope"},
		{"empty_end_turn", "end_turn", "invalid_output", "   "},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFake(t, reply(200, messageJSON(tc.stop, tc.text)))
			_, inTok, outTok, err := chat(f.chatter(), "sys", []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: "q"}})
			if err == nil {
				t.Fatal("expected error")
			}
			kind, _ := kindOf(t, err)
			if kind != tc.kind || inTok != 11 || outTok != 22 {
				t.Fatalf("kind=%s in=%d out=%d", kind, inTok, outTok)
			}
			assertNoLeak(t, tc.name, err)
		})
	}
}

func TestChatClassifiesRateLimit(t *testing.T) {
	f := newFake(t, reply(429, errorJSON("rate_limit_error")))
	_, _, _, err := chat(f.chatter(), "sys", []kanban.ChatTurn{{Role: kanban.AIRoleUser, Body: secretMsg}})
	if err == nil {
		t.Fatal("accepted")
	}
	kind, status := kindOf(t, err)
	if kind != "rate_limit" || status != 429 {
		t.Fatalf("kind=%s status=%d", kind, status)
	}
	assertNoLeak(t, "429", err)
}

func TestFailureSatisfiesFormatFailure(t *testing.T) {
	err := error(&Failure{Kind: "server", Status: 500})
	var failure kanban.FormatFailure
	if !errors.As(err, &failure) || failure.FailureKind() != "server" {
		t.Fatalf("Failure must satisfy kanban.FormatFailure")
	}
	if err.Error() != "ai chat failed: server" {
		t.Fatalf("message=%q", err.Error())
	}
}

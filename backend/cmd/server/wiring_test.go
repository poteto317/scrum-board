package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"scrumboard/internal/kanban"
)

const (
	secretKey   = "SENTINEL-NOT-A-REAL-API-KEY"
	secretReply = "SENTINEL-UPSTREAM-body"
)

// smallRepo implements only what POST /api/items/refined touches and counts card creations.
type smallRepo struct {
	kanban.Repository
	created  atomic.Int32
	deadline atomic.Value // time.Time of the context given to GetColumnByName
}

func (r *smallRepo) GetColumnByName(ctx context.Context, _ string) (kanban.Column, error) {
	if d, ok := ctx.Deadline(); ok {
		r.deadline.Store(d)
	}
	return kanban.Column{ID: 1, Name: "Todo"}, nil
}

func (r *smallRepo) CreateItem(_ context.Context, in kanban.ItemInput) (kanban.Item, error) {
	r.created.Add(1)
	return kanban.Item{ID: 1, Number: 1, ColumnID: in.ColumnID, Title: in.Title, Description: in.Description}, nil
}

func (r *smallRepo) UserBySessionID(_ context.Context, sessionID string, _ time.Time) (kanban.User, error) {
	if sessionID != kanban.HandlerTestSessionID {
		return kanban.User{}, kanban.ErrUnauthorized
	}
	return kanban.User{ID: 1, LoginName: "admin", DisplayName: "admin", Role: kanban.RoleAdmin}, nil
}

// ListProjects records the request deadline that the project routes see.
func (r *smallRepo) ListProjects(ctx context.Context) ([]kanban.Project, error) {
	if d, ok := ctx.Deadline(); ok {
		r.deadline.Store(d)
	}
	return []kanban.Project{{ID: 1, Name: "メイン"}}, nil
}

func (r *smallRepo) ListProjectAIMessages(context.Context, int64, int64, int64) ([]kanban.ProjectAIMessage, error) {
	return []kanban.ProjectAIMessage{}, nil
}

// LatestProjectAIConversation: a POST without a conversation asks for the latest one. There is none.
func (r *smallRepo) LatestProjectAIConversation(context.Context, int64, int64) (*kanban.ProjectAIConversation, error) {
	return nil, nil
}

func (r *smallRepo) GetAIUsage(context.Context) (kanban.AIUsage, error) {
	return kanban.AIUsage{}, nil
}

func (r *smallRepo) AddAIUsage(context.Context, int64, int64, int64) error {
	return nil
}

func getenvFrom(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func isolate(t *testing.T) {
	t.Helper()
	for _, name := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_PROFILE", "ANTHROPIC_CUSTOM_HEADERS"} {
		t.Setenv(name, "")
	}
}

type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}
func (b *safeBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.buf.String() }

func captureLogs(t *testing.T) *safeBuffer {
	t.Helper()
	buf := &safeBuffer{}
	previous, output, flags := slog.Default(), log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	// slog.SetDefault also redirects the standard log package, and restoring the old logger does not undo that.
	t.Cleanup(func() {
		slog.SetDefault(previous)
		log.SetOutput(output)
		log.SetFlags(flags)
	})
	return buf
}

func postRefined(h http.Handler, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/items/refined", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: kanban.SessionCookieName, Value: kanban.HandlerTestSessionID})
	h.ServeHTTP(w, r)
	return w
}

func answer(title, description string) string {
	text, _ := json.Marshal(map[string]string{"title": title, "description": description})
	body, _ := json.Marshal(map[string]any{
		"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
		"content":     []map[string]any{{"type": "text", "text": string(text)}},
		"stop_reason": "end_turn", "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
	})
	return string(body)
}

func TestWithoutAKeyOnlyTheRefinedEndpointIsUnavailable(t *testing.T) {
	isolate(t)
	repo := &smallRepo{}
	h := buildHandler(repo, getenvFrom(nil))
	w := postRefined(h, `{"title":"x"}`)
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 503 || body["code"] != "ai_not_configured" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	health := httptest.NewRecorder()
	h.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != 200 || repo.created.Load() != 0 {
		t.Fatalf("health=%d created=%d", health.Code, repo.created.Load())
	}
	if newFormatter(getenvFrom(nil)) != nil {
		t.Fatal("a missing key must give a nil formatter")
	}
}

func TestWithAKeyTheRefinedEndpointReachesTheModelFromTheEnvironment(t *testing.T) {
	isolate(t)
	var model atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var sent map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &sent)
		model.Store(sent["model"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, answer("整えた題名", "整えた説明"))
	}))
	defer srv.Close()
	for name, tc := range map[string]struct {
		env  map[string]string
		want string
	}{
		"default model":                     {map[string]string{"ANTHROPIC_API_KEY": secretKey}, "claude-haiku-5-5"},
		"model override":                    {map[string]string{"ANTHROPIC_API_KEY": secretKey, "ANTHROPIC_MODEL": "claude-sonnet-5-5"}, "claude-sonnet-5-5"},
		"model with surrounding whitespace": {map[string]string{"ANTHROPIC_API_KEY": secretKey, "ANTHROPIC_MODEL": " \tclaude-sonnet-5-5 \n"}, "claude-sonnet-5-5"},
		"blank model falls back to default": {map[string]string{"ANTHROPIC_API_KEY": secretKey, "ANTHROPIC_MODEL": " \n\t "}, "claude-haiku-5-5"},
	} {
		repo := &smallRepo{}
		w := postRefined(buildHandler(repo, getenvFrom(tc.env), option.WithBaseURL(srv.URL)), `{"title":"下書き"}`)
		var card kanban.Item
		_ = json.Unmarshal(w.Body.Bytes(), &card)
		if w.Code != 201 || card.Title != "整えた題名" || repo.created.Load() != 1 || model.Load() != tc.want {
			t.Fatalf("%s: status=%d card=%+v created=%d model=%v body=%s", name, w.Code, card, repo.created.Load(), model.Load(), w.Body)
		}
	}
}

func TestRateLimitEnvViaBuildHandler(t *testing.T) {
	isolate(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, answer("題名", "説明"))
	}))
	defer srv.Close()
	repo := &smallRepo{}
	env := map[string]string{"ANTHROPIC_API_KEY": secretKey, "AI_RATE_LIMIT_PER_MINUTE": "1"}
	h := buildHandler(repo, getenvFrom(env), option.WithBaseURL(srv.URL))
	if w := postRefined(h, `{"title":"下書きタイトルです"}`); w.Code != 201 {
		t.Fatalf("first: %d %s", w.Code, w.Body)
	}
	w := postRefined(h, `{"title":"下書きタイトルです"}`)
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 429 || body["code"] != "ai_rate_limit" {
		t.Fatalf("second: status=%d body=%s", w.Code, w.Body)
	}
}

func TestRealFormatterFailuresNeverCreateACardOrLeak(t *testing.T) {
	isolate(t)
	logs := captureLogs(t)
	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"unauthorized": {401, `{"type":"error","error":{"type":"authentication_error","message":"` + secretReply + secretKey + `"}}`},
		"forbidden":    {403, secretReply},
		"rate limited": {429, secretReply},
		"server error": {500, secretReply + secretKey},
		"overloaded":   {529, secretReply},
		"garbled":      {200, `<html>` + secretReply},
		"not json":     {200, strings.Replace(answer("a", "b"), `\"title\"`, secretReply, 1)},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(tc.status)
			_, _ = io.WriteString(w, tc.body)
		}))
		repo := &smallRepo{}
		w := postRefined(buildHandler(repo, getenvFrom(map[string]string{"ANTHROPIC_API_KEY": secretKey}), option.WithBaseURL(srv.URL)), `{"title":"下書き"}`)
		srv.Close()
		var body map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != 502 || body["code"] != "ai_failed" || repo.created.Load() != 0 {
			t.Fatalf("%s: status=%d created=%d body=%s", name, w.Code, repo.created.Load(), w.Body)
		}
		for _, secret := range []string{secretKey, secretReply} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("%s: response leaked %q", name, secret)
			}
		}
	}
	if !strings.Contains(logs.String(), "kind=") {
		t.Fatalf("failures must be logged with their kind:\n%s", logs.String())
	}
	for _, secret := range []string{secretKey, secretReply} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("log leaked %q:\n%s", secret, logs.String())
		}
	}
}

func TestRequestsAreLimitedToTheOverallTimeout(t *testing.T) {
	isolate(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, answer("題名", "説明"))
	}))
	defer srv.Close()
	repo := &smallRepo{}
	h := buildHandler(repo, getenvFrom(map[string]string{"ANTHROPIC_API_KEY": secretKey}), option.WithBaseURL(srv.URL))
	before := time.Now()
	if w := postRefined(h, `{"title":"x"}`); w.Code != 201 {
		t.Fatalf("status=%d", w.Code)
	}
	deadline, ok := repo.deadline.Load().(time.Time)
	if !ok || deadline.Sub(before) > kanban.RequestTimeout+time.Second || deadline.Sub(before) < kanban.RequestTimeout-time.Second {
		t.Fatalf("the repository must see a request deadline of about %v, got %v (set=%v)", kanban.RequestTimeout, deadline.Sub(before), ok)
	}
}

func TestAKeyWithSurroundingWhitespaceIsTrimmedAndABlankKeyMeansNotConfigured(t *testing.T) {
	isolate(t)
	var auth atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Store(r.Header.Get("Authorization") + r.Header.Get("X-Api-Key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, answer("題名", "説明"))
	}))
	defer srv.Close()
	repo := &smallRepo{}
	h := buildHandler(repo, getenvFrom(map[string]string{"ANTHROPIC_API_KEY": "  " + secretKey + "\n"}), option.WithBaseURL(srv.URL))
	if w := postRefined(h, `{"title":"x"}`); w.Code != 201 {
		t.Fatalf("a key with a trailing newline must work: status=%d body=%s", w.Code, w.Body)
	}
	if got, _ := auth.Load().(string); got != "Bearer "+secretKey && got != secretKey {
		t.Fatalf("the key must be sent trimmed, got %q", got)
	}
	for _, blank := range []string{" ", "\n", " \t\n "} {
		if newFormatter(getenvFrom(map[string]string{"ANTHROPIC_API_KEY": blank})) != nil {
			t.Fatalf("a blank key %q must mean not configured", blank)
		}
	}
}

func TestOnlyTheProjectChatPostGetsTheLongTimeout(t *testing.T) {
	isolate(t)
	cases := []struct {
		name, method, target, body string
		status                     int
		want                       time.Duration
	}{
		// 存在しないプロジェクト（404）でも、期限はハンドラーに入る前に決まっている。
		{"project chat POST", http.MethodPost, "/api/projects/999/ai-chat", `{"message":"q"}`, 404, kanban.ProjectChatRequestTimeout},
		{"project chat GET", http.MethodGet, "/api/projects/1/ai-chat", "", 200, kanban.RequestTimeout},
		{"project chat DELETE", http.MethodDelete, "/api/projects/999/ai-chat", "", 404, kanban.RequestTimeout},
		{"project list", http.MethodGet, "/api/projects", "", 200, kanban.RequestTimeout},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &smallRepo{}
			h := buildHandler(repo, getenvFrom(map[string]string{}))
			w := httptest.NewRecorder()
			r := httptest.NewRequest(tc.method, tc.target, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(&http.Cookie{Name: kanban.SessionCookieName, Value: kanban.HandlerTestSessionID})
			before := time.Now()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			deadline, ok := repo.deadline.Load().(time.Time)
			if got := deadline.Sub(before); !ok || got > tc.want+time.Second || got < tc.want-time.Second {
				t.Fatalf("request deadline must be about %v, got %v (set=%v)", tc.want, got, ok)
			}
		})
	}
	if kanban.ProjectChatRequestTimeout != 50*time.Second || kanban.RequestTimeout != 15*time.Second {
		t.Fatalf("timeouts=%v %v", kanban.ProjectChatRequestTimeout, kanban.RequestTimeout)
	}
}

func TestIsProjectAIChatPost(t *testing.T) {
	cases := []struct {
		method, target string
		want           bool
	}{
		{http.MethodPost, "/api/projects/1/ai-chat", true},
		{http.MethodPost, "/api/projects/abc/ai-chat", true}, // the handler answers 400; still this route
		{http.MethodGet, "/api/projects/1/ai-chat", false},
		{http.MethodDelete, "/api/projects/1/ai-chat", false},
		{http.MethodPost, "/api/projects/1", false},
		{http.MethodPost, "/api/projects//ai-chat", false},
		{http.MethodPost, "/api/projects/1/x/ai-chat", false},
		{http.MethodPost, "/api/items/by-number/1/ai-chat", false},
		{http.MethodPost, "/api/items/refined", false},
	}
	for _, tc := range cases {
		if got := isProjectAIChatPost(httptest.NewRequest(tc.method, tc.target, nil)); got != tc.want {
			t.Fatalf("%s %s => %v", tc.method, tc.target, got)
		}
	}
}

func TestWithAKeyTheProjectChatUsesToolsThroughTheRealChatter(t *testing.T) {
	isolate(t)
	var bodies []map[string]any
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		reply, _ := json.Marshal(map[string]any{
			"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
			"content":     []map[string]any{{"type": "text", "text": "プロジェクトの回答"}},
			"stop_reason": "end_turn", "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": 3, "output_tokens": 4},
		})
		_, _ = w.Write(reply)
	}))
	defer srv.Close()
	repo := &projectChatRepo{}
	h := buildHandler(repo, getenvFrom(map[string]string{"ANTHROPIC_API_KEY": secretKey}), option.WithBaseURL(srv.URL))
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/projects/1/ai-chat", strings.NewReader(`{"message":"期限が近いものは？"}`))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: kanban.SessionCookieName, Value: kanban.HandlerTestSessionID})
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "プロジェクトの回答") || !strings.Contains(w.Body.String(), `"conversation":{"id":1,`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 1 {
		t.Fatalf("model calls=%d", len(bodies))
	}
	tools, _ := bodies[0]["tools"].([]any)
	if len(tools) != 5 || tools[0].(map[string]any)["name"] != "search_items" || tools[1].(map[string]any)["name"] != "get_item" {
		t.Fatalf("the real chatter must be given all five tools (two reads, three proposals): %v", bodies[0]["tools"])
	}
	if repo.appended.Load() != 1 {
		t.Fatalf("stored turns=%d", repo.appended.Load())
	}
}

// projectChatRepo implements what a POST /api/projects/{id}/ai-chat without tool calls touches.
type projectChatRepo struct {
	smallRepo
	appended atomic.Int32
}

func (r *projectChatRepo) Columns(context.Context) ([]kanban.Column, error) {
	return []kanban.Column{{ID: 1, Name: "Todo"}}, nil
}

func (r *projectChatRepo) AppendProjectAITurn(_ context.Context, projectID, _ int64, _ *int64, turn kanban.ProjectAITurn) (kanban.ProjectAIConversation, error) {
	r.appended.Add(1)
	return kanban.ProjectAIConversation{ID: 1, ProjectID: projectID, Title: turn.Title}, nil
}

func (r *projectChatRepo) ListProjectAIMessages(_ context.Context, _, _, conversationID int64) ([]kanban.ProjectAIMessage, error) {
	if r.appended.Load() == 0 {
		return []kanban.ProjectAIMessage{}, nil
	}
	return []kanban.ProjectAIMessage{
		{ID: 1, ProjectID: 1, ConversationID: conversationID, Role: kanban.AIRoleUser, Body: "期限が近いものは？"},
		{ID: 2, ProjectID: 1, ConversationID: conversationID, Role: kanban.AIRoleAssistant, Body: "プロジェクトの回答"},
	}, nil
}

type usageRecord struct{ requests, in, out int64 }

// toolChatRepo adds what a tool call and the usage record touch.
type toolChatRepo struct {
	projectChatRepo
	searches atomic.Int32
	usage    atomic.Value // usageRecord
}

func (r *toolChatRepo) SearchProjectItems(context.Context, int64, kanban.ItemSearch) ([]kanban.Item, error) {
	r.searches.Add(1)
	return []kanban.Item{}, nil
}

func (r *toolChatRepo) AddAIUsage(_ context.Context, requests, inTok, outTok int64) error {
	r.usage.Store(usageRecord{requests, inTok, outTok})
	return nil
}

// 実物のチャットとハンドラーをつないで: 1 回目はツール、2 回目で上流が失敗。
// 502 を返し、履歴には足さず、1 回目の実数と 2 回目の見積もりを利用量に記録する。上流の文言は出さない。
func TestProjectChatFailingAfterAToolCallStillRecordsUsage(t *testing.T) {
	isolate(t)
	logs := captureLogs(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if calls.Add(1) == 1 {
			body, _ := json.Marshal(map[string]any{
				"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
				"content": []map[string]any{{"type": "tool_use", "id": "toolu_1", "name": "search_items",
					"input": map[string]any{"query": "SENTINEL-TOOL-QUERY"}}},
				"stop_reason": "tool_use", "stop_sequence": nil,
				"usage": map[string]any{"input_tokens": 100, "output_tokens": 7},
			})
			_, _ = w.Write(body)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"`+secretReply+`"}}`)
	}))
	defer srv.Close()
	repo := &toolChatRepo{}
	h := buildHandler(repo, getenvFrom(map[string]string{"ANTHROPIC_API_KEY": secretKey}), option.WithBaseURL(srv.URL))
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/projects/1/ai-chat", strings.NewReader(`{"message":"認証は？"}`))
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: kanban.SessionCookieName, Value: kanban.HandlerTestSessionID})
	h.ServeHTTP(w, r)
	if w.Code != 502 || !strings.Contains(w.Body.String(), `"code":"ai_failed"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if calls.Load() != 2 || repo.searches.Load() != 1 || repo.appended.Load() != 0 {
		t.Fatalf("model calls=%d searches=%d appended=%d", calls.Load(), repo.searches.Load(), repo.appended.Load())
	}
	usage, ok := repo.usage.Load().(usageRecord)
	if !ok || usage.requests != 1 || usage.in <= 100 || usage.out != 7 {
		t.Fatalf("usage must be the first call plus an estimate of the failed one: %+v (recorded=%v)", usage, ok)
	}
	for _, secret := range []string{secretKey, secretReply, "SENTINEL-TOOL-QUERY"} {
		if strings.Contains(w.Body.String(), secret) || strings.Contains(logs.String(), secret) {
			t.Fatalf("leaked %q: body=%s logs=%s", secret, w.Body.String(), logs.String())
		}
	}
}

// 期限の切り替えは、中のハンドラーが何であっても、経路だけで決まる。
func TestWithRouteTimeoutsPicksTheLimitByRoute(t *testing.T) {
	var got time.Duration
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadline, ok := r.Context().Deadline()
		if !ok {
			t.Errorf("%s %s has no deadline", r.Method, r.URL.Path)
		}
		got = time.Until(deadline)
		w.WriteHeader(http.StatusNoContent)
	})
	h := withRouteTimeouts(inner)
	cases := []struct {
		method, target string
		want           time.Duration
	}{
		{http.MethodPost, "/api/projects/1/ai-chat", kanban.ProjectChatRequestTimeout},
		{http.MethodGet, "/api/projects/1/ai-chat", kanban.RequestTimeout},
		{http.MethodPost, "/api/items/by-number/1/ai-chat", kanban.RequestTimeout},
		{http.MethodPost, "/api/items/1/attachments", 60 * time.Second},
		{http.MethodGet, "/api/attachments/1/content", 60 * time.Second},
		{http.MethodGet, "/api/board", kanban.RequestTimeout},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.target, nil))
		if w.Code != http.StatusNoContent {
			t.Fatalf("%s %s: status=%d", tc.method, tc.target, w.Code)
		}
		if got > tc.want || got < tc.want-time.Second {
			t.Fatalf("%s %s: deadline in %v, want about %v", tc.method, tc.target, got, tc.want)
		}
	}
}

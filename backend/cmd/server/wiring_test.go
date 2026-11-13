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
	secretKey   = "SENTINEL-KEY-sk-ant-123"
	secretReply = "SENTINEL-UPSTREAM-body"
)

// smallRepo implements only what POST /api/cards/refined touches and counts card creations.
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

func (r *smallRepo) CreateCard(_ context.Context, in kanban.CardInput) (kanban.Card, error) {
	r.created.Add(1)
	return kanban.Card{ID: 1, Number: 1, ColumnID: in.ColumnID, Title: in.Title, Description: in.Description}, nil
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
	r := httptest.NewRequest(http.MethodPost, "/api/cards/refined", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
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
		var card kanban.Card
		_ = json.Unmarshal(w.Body.Bytes(), &card)
		if w.Code != 201 || card.Title != "整えた題名" || repo.created.Load() != 1 || model.Load() != tc.want {
			t.Fatalf("%s: status=%d card=%+v created=%d model=%v body=%s", name, w.Code, card, repo.created.Load(), model.Load(), w.Body)
		}
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

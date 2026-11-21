package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

type fakeChatter struct {
	mu       sync.Mutex
	calls    int
	systems  []string
	messages [][]ChatTurn
	fn       func(context.Context, string, []ChatTurn) (string, int64, int64, error)
}

func (f *fakeChatter) Chat(ctx context.Context, system string, messages []ChatTurn) (string, int64, int64, error) {
	f.mu.Lock()
	f.calls++
	f.systems = append(f.systems, system)
	cp := append([]ChatTurn(nil), messages...)
	f.messages = append(f.messages, cp)
	fn := f.fn
	f.mu.Unlock()
	return fn(ctx, system, messages)
}

func aiChatPath(number int64) string {
	return "/api/items/by-number/" + strconv.FormatInt(number, 10) + "/ai-chat"
}

func TestAIChatGETDELETEWithoutKeyOK(t *testing.T) {
	repo := fresh()
	card, err := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "題名", Description: "説明"})
	if err != nil {
		t.Fatal(err)
	}
	_ = repo.AppendAITurn(context.Background(), card.ID, "u", "a", 0, 0)
	h := NewHandler(repo) // no chatter
	w := request(h, "GET", aiChatPath(card.Number), "")
	if w.Code != 200 {
		t.Fatalf("GET without key: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Messages []AIMessage `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Messages) != 2 {
		t.Fatalf("body=%s err=%v", w.Body.String(), err)
	}
	w = request(h, "DELETE", aiChatPath(card.Number), "")
	if w.Code != 204 {
		t.Fatalf("DELETE without key: %d", w.Code)
	}
	list, _ := repo.ListAIMessages(context.Background(), card.ID)
	if len(list) != 0 {
		t.Fatalf("cleared want 0, got %d", len(list))
	}
}

func TestAIChatPOSTWithoutKey503(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	h := NewHandler(repo)
	w := request(h, "POST", aiChatPath(card.Number), `{"message":"こんにちは"}`)
	if w.Code != 503 {
		t.Fatalf("want 503, got %d %s", w.Code, w.Body.String())
	}
}

func TestAIChatAuthAndACL(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "ok", 1, 1, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))

	w := requestWithCookie(h, "GET", aiChatPath(card.Number), "", "")
	if w.Code != 401 {
		t.Fatalf("unauthenticated GET: %d", w.Code)
	}
	w = requestWithCookie(h, "GET", "/api/ai/usage", "", "")
	if w.Code != 401 {
		t.Fatalf("unauthenticated usage: %d", w.Code)
	}

	// Restricted edit for non-owner: create member session and restrict card.
	now := time.Now().UTC()
	member, err := repo.CreateUser(context.Background(), UserCreateInput{
		LoginName: "member1", DisplayName: "m", Password: "member-pass", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.sessions["member-session"] = Session{ID: "member-session", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	_, err = repo.ReplaceItemACL(context.Background(), card.ID, ViewAccessOpen, EditAccessRestricted, nil, []int64{1}) // only admin can edit
	if err != nil {
		t.Fatal(err)
	}
	w = requestWithCookie(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`, "member-session")
	if w.Code != 403 {
		t.Fatalf("member without edit: %d %s", w.Code, w.Body.String())
	}
	w = requestWithCookie(h, "GET", "/api/ai/usage", "", "member-session")
	if w.Code != 200 {
		t.Fatalf("member usage: %d", w.Code)
	}
}

func TestAIChatValidation(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "ok", 1, 1, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))

	for name, body := range map[string]string{
		"empty":   `{"message":""}`,
		"spaces":  `{"message":"   "}`,
		"unknown": `{"message":"hi","extra":1}`,
	} {
		w := request(h, "POST", aiChatPath(card.Number), body)
		if w.Code != 400 {
			t.Fatalf("%s: want 400, got %d %s", name, w.Code, w.Body.String())
		}
	}
	long := strings.Repeat("あ", maxAIChatMessageLen+1)
	w := request(h, "POST", aiChatPath(card.Number), `{"message":`+strconv.Quote(long)+`}`)
	if w.Code != 400 {
		t.Fatalf("overlong: %d (runes=%d)", w.Code, utf8.RuneCountInString(long))
	}
	if chatter.calls != 0 {
		t.Fatalf("chatter should not be called on validation errors")
	}
}

func TestAIChatPOSTSuccessUsageAndNoMutate(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "重要タイトル", Description: "元の説明"})
	_, _ = repo.CreateComment(context.Background(), card.ID, "bob", "既存コメント")
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "アシスタント応答", 10, 20, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))

	w := request(h, "POST", aiChatPath(card.Number), `{"message":"要約して"}`)
	if w.Code != 200 {
		t.Fatalf("POST: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Assistant AIMessage   `json:"assistant"`
		Messages  []AIMessage `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Assistant.Body != "アシスタント応答" || len(resp.Messages) != 2 {
		t.Fatalf("resp=%+v", resp)
	}
	if chatter.calls != 1 {
		t.Fatalf("calls=%d", chatter.calls)
	}
	if !strings.Contains(chatter.systems[0], "重要タイトル") {
		t.Fatalf("system missing title: %s", chatter.systems[0])
	}
	if !strings.Contains(chatter.systems[0], "既存コメント") {
		t.Fatalf("system missing comment: %s", chatter.systems[0])
	}

	got, err := repo.GetItem(context.Background(), card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Description != "元の説明" {
		t.Fatalf("description mutated: %q", got.Description)
	}
	comments, err := repo.ListComments(context.Background(), card.ID)
	if err != nil || len(comments) != 1 || comments[0].Body != "既存コメント" {
		t.Fatalf("comments mutated: %+v err=%v", comments, err)
	}

	uw := request(h, "GET", "/api/ai/usage", "")
	if uw.Code != 200 {
		t.Fatalf("usage: %d", uw.Code)
	}
	var usage struct {
		RequestCount int64 `json:"requestCount"`
		InputTokens  int64 `json:"inputTokens"`
		OutputTokens int64 `json:"outputTokens"`
		Configured   bool  `json:"configured"`
	}
	if err := json.Unmarshal(uw.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	if !usage.Configured || usage.RequestCount != 1 || usage.InputTokens != 10 || usage.OutputTokens != 20 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestAIChatBusy429(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	release := make(chan struct{})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		<-release
		return "", 0, 0, errors.New("stop") // avoid concurrent Append on memoryRepo
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	var wg sync.WaitGroup
	for range maxConcurrentFormats {
		wg.Add(1)
		go func() {
			defer wg.Done()
			request(h, "POST", aiChatPath(card.Number), `{"message":"fill"}`)
		}()
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		chatter.mu.Lock()
		n := chatter.calls
		chatter.mu.Unlock()
		if n >= maxConcurrentFormats {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("chatter calls did not start")
		}
		time.Sleep(time.Millisecond)
	}
	w := request(h, "POST", aiChatPath(card.Number), `{"message":"busy"}`)
	if w.Code != 429 {
		t.Fatalf("want 429, got %d %s", w.Code, w.Body.String())
	}
	close(release)
	wg.Wait()
}

func TestSelectAIChatHistoryForModel(t *testing.T) {
	msgs := make([]AIMessage, 0, 50)
	for i := 0; i < 25; i++ {
		msgs = append(msgs,
			AIMessage{Role: AIRoleUser, Body: "u" + strconv.Itoa(i)},
			AIMessage{Role: AIRoleAssistant, Body: "a" + strconv.Itoa(i)},
		)
	}
	got := selectAIChatHistoryForModel(msgs, maxAIChatHistoryTurns)
	if len(got) != 40 {
		t.Fatalf("want 40, got %d", len(got))
	}
	if got[0].Body != "u5" || got[len(got)-1].Body != "a24" {
		t.Fatalf("got first=%s last=%s", got[0].Body, got[len(got)-1].Body)
	}
}

func TestBuildAIChatSystemIncludesTitle(t *testing.T) {
	sys := buildAIChatSystem(Item{Title: "T1", Description: "D1"}, []Comment{{Author: "a", Body: "c1"}})
	if !strings.Contains(sys, "T1") || !strings.Contains(sys, "D1") || !strings.Contains(sys, "c1") {
		t.Fatalf("system=%s", sys)
	}
}

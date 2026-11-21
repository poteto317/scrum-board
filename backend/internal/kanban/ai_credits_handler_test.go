package kanban

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestBuildAICreditsView(t *testing.T) {
	t.Parallel()
	unlimited := BuildAICreditsView(AIUsage{InputTokens: 3, OutputTokens: 7}, true)
	if !unlimited.Unlimited || unlimited.LimitTokens != nil || unlimited.RemainingTokens != nil || unlimited.UsedTokens != 10 {
		t.Fatalf("unlimited: %+v", unlimited)
	}
	if !unlimited.Approximate || unlimited.Period != "cumulative" || !unlimited.Configured {
		t.Fatalf("flags: %+v", unlimited)
	}
	lim := int64(10)
	atLimit := BuildAICreditsView(AIUsage{InputTokens: 4, OutputTokens: 6, LimitTokens: &lim}, false)
	if atLimit.Unlimited || atLimit.RemainingTokens == nil || *atLimit.RemainingTokens != 0 || atLimit.Configured {
		t.Fatalf("at limit: %+v", atLimit)
	}
	over := int64(5)
	ov := BuildAICreditsView(AIUsage{InputTokens: 4, OutputTokens: 6, LimitTokens: &over}, true)
	if ov.RemainingTokens == nil || *ov.RemainingTokens != 0 {
		t.Fatalf("over: %+v", ov)
	}
}

func TestAICreditsAuthAndAdmin(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := requestWithCookie(h, "GET", "/api/ai/credits", "", "")
	if w.Code != 401 {
		t.Fatalf("unauthenticated GET: %d", w.Code)
	}

	now := time.Now().UTC()
	member, err := repo.CreateUser(context.Background(), UserCreateInput{
		LoginName: "cred-member", DisplayName: "m", Password: "member-pass", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.sessions["cred-member"] = Session{ID: "cred-member", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}

	w = requestWithCookie(h, "GET", "/api/ai/credits", "", "cred-member")
	if w.Code != 200 {
		t.Fatalf("member GET: %d %s", w.Code, w.Body.String())
	}
	var view AICreditsView
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if !view.Unlimited || view.LimitTokens != nil || view.RemainingTokens != nil || view.Configured {
		t.Fatalf("unset view: %+v", view)
	}

	w = requestWithCookie(h, "PUT", "/api/ai/credits", `{"limitTokens":100}`, "cred-member")
	if w.Code != 403 {
		t.Fatalf("member PUT: %d %s", w.Code, w.Body.String())
	}

	w = request(h, "PUT", "/api/ai/credits", `{"limitTokens":100}`)
	if w.Code != 200 {
		t.Fatalf("admin PUT: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.Unlimited || view.LimitTokens == nil || *view.LimitTokens != 100 || view.RemainingTokens == nil || *view.RemainingTokens != 100 {
		t.Fatalf("after set: %+v", view)
	}

	w = request(h, "PUT", "/api/ai/credits", `{"limitTokens":null}`)
	if w.Code != 200 {
		t.Fatalf("admin clear: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if !view.Unlimited {
		t.Fatalf("after clear: %+v", view)
	}
}

func TestAICreditsPutValidation(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	cases := []struct {
		name string
		body string
	}{
		{"empty", `{}`},
		{"negative", `{"limitTokens":-1}`},
		{"float", `{"limitTokens":1.5}`},
		{"unknown", `{"limitTokens":10,"extra":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, "PUT", "/api/ai/credits", tc.body)
			if w.Code != 400 {
				t.Fatalf("want 400, got %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestAICreditLimitBlocksChatAndRefined(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	lim := int64(5)
	if err := repo.SetAICreditLimit(context.Background(), &lim); err != nil {
		t.Fatal(err)
	}
	if err := repo.AddAIUsage(context.Background(), 1, 3, 2); err != nil {
		t.Fatal(err)
	}
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		t.Fatal("chatter must not be called")
		return "", 0, 0, nil
	}}
	formatter := &fakeFormatter{fn: func(context.Context, Draft) (RefinedItem, error) {
		t.Fatal("formatter must not be called")
		return RefinedItem{}, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter), WithItemFormatter(formatter))

	w := request(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`)
	if w.Code != 429 {
		t.Fatalf("ai-chat: want 429, got %d %s", w.Code, w.Body.String())
	}
	if decodeError(t, w).Code != "ai_credit_limit" {
		t.Fatalf("ai-chat code: %+v", decodeError(t, w))
	}

	w = request(h, "POST", "/api/items/refined", `{"title":"下書きタイトルです"}`)
	if w.Code != 429 {
		t.Fatalf("refined: want 429, got %d %s", w.Code, w.Body.String())
	}
	if decodeError(t, w).Code != "ai_credit_limit" {
		t.Fatalf("refined code: %+v", decodeError(t, w))
	}

	// Unlimited: clear limit and ensure chat proceeds.
	if err := repo.SetAICreditLimit(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	chatter.fn = func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "ok", 1, 1, nil
	}
	w = request(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`)
	if w.Code != 200 {
		t.Fatalf("unlimited chat: %d %s", w.Code, w.Body.String())
	}
}

func TestSetAndGetAICreditLimitRepo(t *testing.T) {
	repo := fresh()
	u, err := repo.GetAIUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.LimitTokens != nil {
		t.Fatalf("default limit: %+v", u)
	}
	lim := int64(42)
	if err := repo.SetAICreditLimit(context.Background(), &lim); err != nil {
		t.Fatal(err)
	}
	u, err = repo.GetAIUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.LimitTokens == nil || *u.LimitTokens != 42 {
		t.Fatalf("after set: %+v", u)
	}
	if err := repo.AddAIUsage(context.Background(), 1, 10, 5); err != nil {
		t.Fatal(err)
	}
	u, err = repo.GetAIUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.UsedTokens() != 15 || u.LimitTokens == nil || *u.LimitTokens != 42 {
		t.Fatalf("after usage: %+v", u)
	}
	if err := repo.SetAICreditLimit(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	u, err = repo.GetAIUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.LimitTokens != nil || u.UsedTokens() != 15 {
		t.Fatalf("after clear: %+v", u)
	}
}

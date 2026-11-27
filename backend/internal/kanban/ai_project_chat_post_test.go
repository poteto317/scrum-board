package kanban

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func admissionHandler(lim AIRateLimiter) handler {
	return handler{
		repo:           fresh(),
		projectChatter: &fakeProjectChatter{fn: answers("ok", 1, 1)},
		projectChats:   newUserInFlight(),
		slots:          make(chan struct{}, 1),
		rateLimiter:    lim,
	}
}

func admissionRequest(userID int64) *http.Request {
	r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(`{"message":"q"}`))
	return r.WithContext(withUser(r.Context(), User{ID: userID}))
}

// 通したリクエストは、同じユーザーの実行中の印・回数制限の予約・共有の枠を持ち、release で全部返す。
func TestAdmitProjectChatHoldsAndReleasesEverything(t *testing.T) {
	lim := &countingAIRateLimiter{allow: true}
	h := admissionHandler(lim)
	w := httptest.NewRecorder()
	a, ok := h.admitProjectChat(w, admissionRequest(7), 7)
	if !ok || a == nil {
		t.Fatalf("admitted=%v body=%s", ok, w.Body.String())
	}
	if h.projectChats.begin(7) {
		t.Fatal("the user's running chat must be held")
	}
	if len(h.slots) != 1 {
		t.Fatalf("slots held=%d", len(h.slots))
	}
	a.release()
	if tries, releases := lim.counts(); tries != 1 || releases != 1 {
		t.Fatalf("an unused reservation must be given back: tries=%d releases=%d", tries, releases)
	}
	if len(h.slots) != 0 {
		t.Fatalf("slots held after release=%d", len(h.slots))
	}
	if !h.projectChats.begin(7) {
		t.Fatal("the user's running chat must be free again")
	}
}

// モデルを呼び始めたら、予約は返さない（枠と実行中の印は返す）。
func TestAdmitProjectChatKeepsTheReservationOnceTheModelIsCalled(t *testing.T) {
	lim := &countingAIRateLimiter{allow: true}
	h := admissionHandler(lim)
	a, ok := h.admitProjectChat(httptest.NewRecorder(), admissionRequest(7), 7)
	if !ok {
		t.Fatal("not admitted")
	}
	a.keepRateReservation()
	a.release()
	if tries, releases := lim.counts(); tries != 1 || releases != 0 {
		t.Fatalf("tries=%d releases=%d", tries, releases)
	}
	if len(h.slots) != 0 || !h.projectChats.begin(7) {
		t.Fatal("slot and running chat must be given back")
	}
}

// 弾いたときは、何も持ったままにしない。
func TestAdmitProjectChatRejectionsHoldNothing(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		lim := &countingAIRateLimiter{allow: true}
		h := admissionHandler(lim)
		h.projectChatter = nil
		w := httptest.NewRecorder()
		if _, ok := h.admitProjectChat(w, admissionRequest(7), 7); ok || w.Code != 503 || decodeError(t, w).Code != "ai_not_configured" {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if tries, _ := lim.counts(); tries != 0 || len(h.slots) != 0 || !h.projectChats.begin(7) {
			t.Fatalf("nothing may be held: tries=%d slots=%d", tries, len(h.slots))
		}
	})
	t.Run("same user already running", func(t *testing.T) {
		lim := &countingAIRateLimiter{allow: true}
		h := admissionHandler(lim)
		h.projectChats.begin(7)
		w := httptest.NewRecorder()
		if _, ok := h.admitProjectChat(w, admissionRequest(7), 7); ok || w.Code != 429 || decodeError(t, w).Code != "ai_busy" {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if tries, _ := lim.counts(); tries != 0 || len(h.slots) != 0 {
			t.Fatalf("no reservation and no slot: tries=%d slots=%d", tries, len(h.slots))
		}
		if h.projectChats.begin(7) {
			t.Fatal("the first chat's mark must stay")
		}
	})
	t.Run("rate limited", func(t *testing.T) {
		lim := &countingAIRateLimiter{allow: false}
		h := admissionHandler(lim)
		w := httptest.NewRecorder()
		if _, ok := h.admitProjectChat(w, admissionRequest(7), 7); ok || w.Code != 429 || decodeError(t, w).Code != "ai_rate_limit" {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if tries, releases := lim.counts(); tries != 1 || releases != 0 || len(h.slots) != 0 || !h.projectChats.begin(7) {
			t.Fatalf("tries=%d releases=%d slots=%d", tries, releases, len(h.slots))
		}
	})
	t.Run("no free slot", func(t *testing.T) {
		lim := &countingAIRateLimiter{allow: true}
		h := admissionHandler(lim)
		h.slots <- struct{}{}
		w := httptest.NewRecorder()
		if _, ok := h.admitProjectChat(w, admissionRequest(7), 7); ok || w.Code != 429 || decodeError(t, w).Code != "ai_busy" {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if tries, releases := lim.counts(); tries != 1 || releases != 1 {
			t.Fatalf("the reservation must be given back: tries=%d releases=%d", tries, releases)
		}
		if len(h.slots) != 1 || !h.projectChats.begin(7) {
			t.Fatalf("the other request's slot stays, the user's mark goes: slots=%d", len(h.slots))
		}
	})
}

func TestDecodeProjectChatRequest(t *testing.T) {
	h := handler{messageMax: 10}
	post := func(contentType, body string) (projectAIChatRequest, bool, *httptest.ResponseRecorder) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(body))
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		req, ok := h.decodeProjectChatRequest(w, r)
		return req, ok, w
	}
	req, ok, _ := post("application/json", `{"message":"  hello  ","focusItemNumber":12}`)
	if !ok || req.Message != "hello" || req.FocusItemNumber == nil || *req.FocusItemNumber != 12 {
		t.Fatalf("ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json; charset=utf-8", `{"message":"q"}`); !ok || req.FocusItemNumber != nil || req.ConversationID != nil || req.NewConversation {
		t.Fatalf("no focus item, no conversation: ok=%v req=%+v", ok, req)
	}
	// 会話: ID を付ける・新しい会話にする・どちらも付けない（null や false は、付けないのと同じ）。
	if req, ok, _ = post("application/json", `{"message":"q","conversationId":7}`); !ok || req.ConversationID == nil || *req.ConversationID != 7 || req.NewConversation {
		t.Fatalf("conversationId: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","newConversation":true}`); !ok || req.ConversationID != nil || !req.NewConversation {
		t.Fatalf("newConversation: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","conversationId":null,"newConversation":false}`); !ok || req.ConversationID != nil || req.NewConversation {
		t.Fatalf("null and false: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","conversationId":7,"newConversation":false}`); !ok || req.ConversationID == nil || req.NewConversation {
		t.Fatalf("an id with newConversation false is the id: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q"}`); !ok || req.CrossProjectSearch != nil || req.crossProjectSearchEnabled() {
		t.Fatalf("cross omitted: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","crossProjectSearch":false}`); !ok || req.CrossProjectSearch == nil || *req.CrossProjectSearch || req.crossProjectSearchEnabled() {
		t.Fatalf("cross false: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","crossProjectSearch":true}`); !ok || !req.crossProjectSearchEnabled() {
		t.Fatalf("cross true: ok=%v req=%+v", ok, req)
	}
	if req, ok, _ = post("application/json", `{"message":"q","crossProjectSearch":null}`); !ok || req.CrossProjectSearch != nil || req.crossProjectSearchEnabled() {
		t.Fatalf("cross null: ok=%v req=%+v", ok, req)
	}
	for body, want := range map[string]string{
		`{"message":"q","conversationId":0}`:                        "会話IDが不正です。",
		`{"message":"q","conversationId":-3}`:                       "会話IDが不正です。",
		`{"message":"q","conversationId":7,"newConversation":true}`: "conversationId と newConversation は同時に指定できません。",
		`{"message":"q","conversationId":"7"}`:                      "入力を確認してください。有効なJSONが必要です。",
		`{"message":"q","conversationId":1.5}`:                      "入力を確認してください。有効なJSONが必要です。",
		`{"message":"q","newConversation":"yes"}`:                   "入力を確認してください。有効なJSONが必要です。",
		`{"message":"q","crossProjectSearch":"yes"}`:                "入力を確認してください。有効なJSONが必要です。",
		`{"message":"q","crossProjectSearch":1}`:                    "入力を確認してください。有効なJSONが必要です。",
	} {
		if _, ok, w := post("application/json", body); ok || w.Code != 400 || decodeError(t, w).Message != want || decodeError(t, w).Code != "" {
			t.Fatalf("%s: ok=%v status=%d body=%s", body, ok, w.Code, w.Body.String())
		}
	}
	if _, ok, w := post("text/plain", `{"message":"q"}`); ok || w.Code != 415 || decodeError(t, w).Code != "unsupported_media_type" {
		t.Fatalf("media type: %d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{
		`{"message":""}`, `{"message":"   "}`, `{"message":"12345678901"}`, `{"message":"a\u0000b"}`,
		`{"message":"q","focusItemNumber":0}`, `{"message":"q","focusItemNumber":-1}`, `{"message":"q","focusItemNumber":"1"}`, `{`,
	} {
		if _, ok, w := post("application/json", body); ok || w.Code != 400 || decodeError(t, w).Code != "" {
			t.Fatalf("%s: ok=%v status=%d body=%s", body, ok, w.Code, w.Body.String())
		}
	}
}

func TestClassifyProjectChatFailure(t *testing.T) {
	dbErr := errors.New("db down")
	cases := []struct {
		name             string
		timedOut         bool
		toolErr, chatErr error
		want             projectChatFailure
	}{
		{"answer", false, nil, nil, projectChatSucceeded},
		{"time is up but the answer came", true, nil, nil, projectChatSucceeded},
		{"tool database failure", false, dbErr, nil, projectChatToolFailed},
		{"tool failure wins over the chat error it caused", false, dbErr, dbErr, projectChatToolFailed},
		{"tool deadline", false, fmt.Errorf("search: %w", context.DeadlineExceeded), nil, projectChatToolTimeout},
		{"tool canceled", false, context.Canceled, nil, projectChatToolTimeout},
		{"tool failure after the chat's time ran out", true, dbErr, nil, projectChatToolTimeout},
		{"model failure", false, nil, chatFail{kind: "timeout"}, projectChatModelFailed},
		{"model failure when time is up", true, nil, context.DeadlineExceeded, projectChatModelFailed},
	}
	for _, tc := range cases {
		if got := classifyProjectChatFailure(tc.timedOut, tc.toolErr, tc.chatErr); got != tc.want {
			t.Errorf("%s: got %d want %d", tc.name, got, tc.want)
		}
	}
}

func TestWriteProjectChatFailure(t *testing.T) {
	chatErr := chatFail{kind: "upstream_error", status: 500}
	cases := []struct {
		failure projectChatFailure
		status  int
		code    string
	}{
		{projectChatToolFailed, 500, "server_error"},
		{projectChatToolTimeout, 502, "ai_failed"},
		{projectChatModelFailed, 502, "ai_failed"},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			logs := captureLogs(t)
			w := httptest.NewRecorder()
			writeProjectChatFailure(w, tc.failure, chatErr)
			if e := decodeError(t, w); w.Code != tc.status || e.Code != tc.code {
				t.Fatalf("failure %d: status=%d body=%s", tc.failure, w.Code, w.Body.String())
			}
			if logs.String() == "" {
				t.Fatalf("failure %d must be logged", tc.failure)
			}
		})
	}
	w := httptest.NewRecorder()
	if writeProjectChatFailure(w, projectChatSucceeded, nil); w.Body.Len() != 0 {
		t.Fatalf("success must not be answered here: %s", w.Body.String())
	}
}

func TestUnstoredProjectChatTurn(t *testing.T) {
	before := []ProjectAIMessage{{ID: 1, ProjectID: 3, ConversationID: 8, Role: AIRoleUser, Body: "old q"}, {ID: 2, ProjectID: 3, ConversationID: 8, Role: AIRoleAssistant, Body: "old a"}}
	got := unstoredProjectChatTurn(3, 8, before, ProjectAITurn{UserBody: "q", AssistantBody: "a", InputTokens: 5, OutputTokens: 0})
	if len(got) != 4 || got[0].ID != 1 || got[1].ID != 2 {
		t.Fatalf("history must come first: %+v", got)
	}
	// 仮の 2 件にも、保存先の会話の ID を付ける。
	if got[2].ConversationID != 8 || got[3].ConversationID != 8 {
		t.Fatalf("conversation ids: %+v", got[2:])
	}
	if got[2].Role != AIRoleUser || got[2].Body != "q" || got[2].ProjectID != 3 || got[2].InputTokens != nil {
		t.Fatalf("user message: %+v", got[2])
	}
	last := got[3]
	if last.Role != AIRoleAssistant || last.Body != "a" || last.ProjectID != 3 || last.InputTokens == nil || *last.InputTokens != 5 || last.OutputTokens != nil {
		t.Fatalf("assistant message: %+v", last)
	}
	// 画面は id をキーにして並べるので、仮の 2 件にも、互いにも履歴とも重ならない（負の）ID を振る。
	if got[2].ID != -2 || got[3].ID != -1 {
		t.Fatalf("placeholder ids: user=%d assistant=%d", got[2].ID, got[3].ID)
	}
	seen := map[int64]bool{}
	for _, m := range got {
		if seen[m.ID] {
			t.Fatalf("duplicate id %d in %+v", m.ID, got)
		}
		seen[m.ID] = true
	}
	if len(before) != 2 {
		t.Fatal("the history that was passed in must not grow")
	}
	// 履歴の配列に空きがあっても、渡した側の配列を書き換えない。
	roomy := make([]ProjectAIMessage, 1, 8)
	roomy[0] = ProjectAIMessage{ID: 9}
	_ = unstoredProjectChatTurn(3, 8, roomy, ProjectAITurn{UserBody: "q", AssistantBody: "a"})
	if spare := roomy[:2][1]; spare.Body != "" {
		t.Fatalf("the caller's backing array was written: %+v", spare)
	}
}

// 読むのは列・開いているアイテム・続ける会話の履歴。別の会話・別のユーザーの履歴は入らない。
func TestLoadProjectChatInput(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	mine, err := repo.AppendProjectAITurn(ctx, 1, 7, nil, ProjectAITurn{Title: "t", UserBody: "old q", AssistantBody: "old a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendProjectAITurn(ctx, 1, 7, nil, ProjectAITurn{Title: "t", UserBody: "another conversation", AssistantBody: "answer", InputTokens: 1, OutputTokens: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendProjectAITurn(ctx, 1, 8, nil, ProjectAITurn{Title: "t", UserBody: "someone else's", AssistantBody: "answer", InputTokens: 1, OutputTokens: 1}); err != nil {
		t.Fatal(err)
	}
	h := handler{repo: repo, historyTurns: 20}
	in, err := h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &User{ID: 7}, &mine, projectAIChatRequest{Message: "new q"}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(in.system, "Alpha") || strings.Contains(in.system, "いま開いているアイテム（") {
		t.Fatalf("system=%s", in.system)
	}
	if len(in.columns) != 3 || len(in.history) != 2 || len(in.turns) != 3 || in.turns[0].Body != "old q" || in.turns[2].Body != "new q" {
		t.Fatalf("columns=%d history=%d turns=%+v", len(in.columns), len(in.history), in.turns)
	}
	if in.crossProject || len(in.projectNames) != 1 || in.projectNames[1] != "Alpha" {
		t.Fatalf("off names: cross=%v names=%v", in.crossProject, in.projectNames)
	}
	if _, err := repo.CreateProject(ctx, "Beta"); err != nil {
		t.Fatal(err)
	}
	on := true
	in, err = h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &User{ID: 7}, &mine, projectAIChatRequest{Message: "new q", CrossProjectSearch: &on}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !in.crossProject || !strings.Contains(in.system, "横断検索がオン") || len(in.projectNames) < 2 {
		t.Fatalf("on cross: cross=%v systemCross=%v names=%v", in.crossProject, strings.Contains(in.system, "横断検索がオン"), in.projectNames)
	}
	// 新しい会話は、履歴なし（空の配列で、nil ではない）。
	in, err = h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &User{ID: 7}, nil, projectAIChatRequest{Message: "new q"}, nil, false)
	if err != nil || in.history == nil || len(in.history) != 0 || len(in.turns) != 1 || in.turns[0].Body != "new q" {
		t.Fatalf("a new conversation has no history: err=%v history=%+v turns=%+v", err, in.history, in.turns)
	}
}

// プロンプトと会話は、読んだものだけから決まる（時刻は引数）。
func TestNewProjectChatInput(t *testing.T) {
	now := time.Date(2026, 11, 26, 16, 0, 0, 0, time.UTC) // Asia/Tokyo では翌日の 1:00
	columns := []Column{{ID: 1, Name: "Todo"}, {ID: 2, Name: "Doing"}}
	history := []ProjectAIMessage{
		{Role: AIRoleUser, Body: "q1"}, {Role: AIRoleAssistant, Body: "a1"},
		{Role: AIRoleUser, Body: "q2"}, {Role: AIRoleAssistant, Body: "a2"},
	}
	focus := &projectChatFocus{Item: Item{Number: 12, Title: "開いているもの"}}
	in := newProjectChatInput("Alpha", now, columns, focus, history, "new q", 1, false, nil)
	for _, want := range []string{"Alpha", "2026-11-27", "Todo", "Doing", "いま開いているアイテム（#12）", "開いているもの"} {
		if !strings.Contains(in.system, want) {
			t.Fatalf("system lacks %q:\n%s", want, in.system)
		}
	}
	want := []ChatTurn{{Role: AIRoleUser, Body: "q2"}, {Role: AIRoleAssistant, Body: "a2"}, {Role: AIRoleUser, Body: "new q"}}
	if len(in.turns) != len(want) {
		t.Fatalf("turns=%+v", in.turns)
	}
	for i := range want {
		if in.turns[i] != want[i] {
			t.Fatalf("turn %d=%+v", i, in.turns[i])
		}
	}
	if len(in.history) != 4 || len(in.columns) != 2 {
		t.Fatalf("history and columns are passed on whole: %d %d", len(in.history), len(in.columns))
	}
	if none := newProjectChatInput("Alpha", now, columns, nil, nil, "q", 20, false, nil); strings.Contains(none.system, "いま開いているアイテム（") || len(none.turns) != 1 {
		t.Fatalf("no focus, no history: %+v", none.turns)
	}
}


func TestLoadProjectChatFocusStaysOnURLProjectWhenCross(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	other, err := repo.CreateProject(ctx, "Other")
	if err != nil {
		t.Fatal(err)
	}
	there, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "elsewhere", ProjectID: &other.ID})
	if err != nil {
		t.Fatal(err)
	}
	admin := repo.users[0]
	h := handler{repo: repo, historyTurns: 20}
	on := true
	n := there.Number // numbers are per-project; URL project has no item with this number yet
	in, err := h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &admin, nil, projectAIChatRequest{Message: "q", CrossProjectSearch: &on, FocusItemNumber: &n}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(in.system, "# いま開いているアイテム") {
		t.Fatalf("other-project-only focus must not enter system:\n%s", in.system)
	}
	here, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "here-focus"})
	if err != nil {
		t.Fatal(err)
	}
	n = here.Number
	in, err = h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &admin, nil, projectAIChatRequest{Message: "q", CrossProjectSearch: &on, FocusItemNumber: &n}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(in.system, "# いま開いているアイテム") || !strings.Contains(in.system, "here-focus") {
		t.Fatalf("URL focus must enter system:\n%s", in.system)
	}
}

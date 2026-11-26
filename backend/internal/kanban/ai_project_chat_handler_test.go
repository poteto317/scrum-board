package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type projectChatFn func(ctx context.Context, system string, turns []ChatTurn, run ToolRunner) (string, int64, int64, error)

// fakeProjectChatter implements both chat interfaces, like the real aichat.Chatter.
type fakeProjectChatter struct {
	mu       sync.Mutex
	calls    int
	systems  []string
	turns    [][]ChatTurn
	tools    []ChatTool
	maxCalls []int
	fn       projectChatFn
}

func (f *fakeProjectChatter) Chat(context.Context, string, []ChatTurn) (string, int64, int64, error) {
	return "item chat", 1, 1, nil
}

func (f *fakeProjectChatter) ChatWithTools(ctx context.Context, system string, turns []ChatTurn, tools []ChatTool, run ToolRunner, maxModelCalls int) (string, int64, int64, error) {
	f.mu.Lock()
	f.calls++
	f.systems = append(f.systems, system)
	f.turns = append(f.turns, append([]ChatTurn(nil), turns...))
	f.tools = tools
	f.maxCalls = append(f.maxCalls, maxModelCalls)
	fn := f.fn
	f.mu.Unlock()
	return fn(ctx, system, turns, run)
}

func (f *fakeProjectChatter) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeProjectChatter) lastSystem() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.systems[len(f.systems)-1]
}

func answers(text string, inTok, outTok int64) projectChatFn {
	return func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		return text, inTok, outTok, nil
	}
}

func projectChatPath(projectID int64) string {
	return "/api/projects/" + strconv.FormatInt(projectID, 10) + "/ai-chat"
}

func postProjectChat(h http.Handler, projectID int64, body string) *httptest.ResponseRecorder {
	return request(h, "POST", projectChatPath(projectID), body)
}

type projectChatReply struct {
	Assistant ProjectAIMessage   `json:"assistant"`
	Messages  []ProjectAIMessage `json:"messages"`
}

func decodeProjectChat(t *testing.T, w *httptest.ResponseRecorder) projectChatReply {
	t.Helper()
	var out projectChatReply
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("body=%s err=%v", w.Body.String(), err)
	}
	return out
}

func projectHistory(t *testing.T, repo Repository, projectID, userID int64) []ProjectAIMessage {
	t.Helper()
	list, err := repo.ListProjectAIMessages(context.Background(), projectID, userID)
	if err != nil {
		t.Fatal(err)
	}
	return list
}

// 受け入れ条件 1・4: ツールを実行して結果を返し、最後の文章だけを保存して返す。トークンは合計を記録する。
func TestProjectAIChatRunsToolsAndStoresOnlyTheFinalAnswer(t *testing.T) {
	f := newToolFixture(t)
	card := f.item(t, ItemInput{Title: "認証の方式を決める", Description: "OAuth にする"})
	var toolOutputs []string
	chatter := &fakeProjectChatter{fn: func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
		for _, call := range []ToolCall{
			{ID: "1", Name: toolSearchItems, Input: json.RawMessage(`{"query":"認証"}`)},
			{ID: "2", Name: toolGetItem, Input: json.RawMessage(fmt.Sprintf(`{"number":%d}`, card.Number))},
		} {
			out, err := run(ctx, call)
			if err != nil {
				return "", 0, 0, err
			}
			toolOutputs = append(toolOutputs, out)
		}
		return fmt.Sprintf("#%d 認証の方式を決める で決めています。", card.Number), 300, 40, nil
	}}
	h := NewHandler(f.repo, WithAIChat(chatter))
	w := postProjectChat(h, 1, `{"message":"  認証まわりで決めたことは？ "}`)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if len(toolOutputs) != 2 || !strings.Contains(toolOutputs[0], `"title":"認証の方式を決める"`) || !strings.Contains(toolOutputs[1], "OAuth にする") {
		t.Fatalf("tool outputs=%v", toolOutputs)
	}
	out := decodeProjectChat(t, w)
	want := fmt.Sprintf("#%d 認証の方式を決める で決めています。", card.Number)
	if out.Assistant.Role != AIRoleAssistant || out.Assistant.Body != want || out.Assistant.ProjectID != 1 || out.Assistant.ID == 0 ||
		out.Assistant.InputTokens == nil || *out.Assistant.InputTokens != 300 || *out.Assistant.OutputTokens != 40 {
		t.Fatalf("assistant=%+v", out.Assistant)
	}
	if len(out.Messages) != 2 || out.Messages[0].Role != AIRoleUser || out.Messages[0].Body != "認証まわりで決めたことは？" || out.Messages[1].ID != out.Assistant.ID {
		t.Fatalf("messages=%+v", out.Messages)
	}
	// ユーザー ID は応答に含めない。
	if strings.Contains(w.Body.String(), "userId") {
		t.Fatalf("user id must not be in the reply: %s", w.Body.String())
	}
	// 保存するのは、ユーザーのメッセージと最後の回答だけ（ツールのやり取りは保存しない）。
	stored := projectHistory(t, f.repo, 1, f.admin.ID)
	if len(stored) != 2 || stored[0].Body != "認証まわりで決めたことは？" || stored[1].Body != want {
		t.Fatalf("stored=%+v", stored)
	}
	// モデルの呼び出しは最大 4 回、ツールは 2 つ。
	if chatter.maxCalls[0] != 4 || maxProjectChatModelCalls != 4 || len(chatter.tools) != 2 {
		t.Fatalf("maxCalls=%v tools=%d", chatter.maxCalls, len(chatter.tools))
	}
	usage, _ := f.repo.GetAIUsage(context.Background())
	if usage.RequestCount != 1 || usage.InputTokens != 300 || usage.OutputTokens != 40 {
		t.Fatalf("usage=%+v", usage)
	}
	// 次のメッセージには、直近の履歴が付く。
	chatter.fn = answers("2 回目", 1, 1)
	if w = postProjectChat(h, 1, `{"message":"続き"}`); w.Code != 200 {
		t.Fatalf("second: %d %s", w.Code, w.Body.String())
	}
	turns := chatter.turns[1]
	if len(turns) != 3 || turns[0].Body != "認証まわりで決めたことは？" || turns[1].Role != AIRoleAssistant || turns[2].Body != "続き" {
		t.Fatalf("turns=%+v", turns)
	}
	if got := decodeProjectChat(t, w); len(got.Messages) != 4 {
		t.Fatalf("messages=%d", len(got.Messages))
	}
}

// 受け入れ条件 2: ハンドラー経由でも、ツールは URL のプロジェクトと呼び出したユーザーに縛られる。
func TestProjectAIChatToolsAreBoundToTheURLProjectAndTheCaller(t *testing.T) {
	f := newToolFixture(t)
	mine := f.item(t, ItemInput{Title: "共通 見える"})
	hidden := f.item(t, ItemInput{Title: "共通 見えない", Description: "SECRET-BODY"})
	if _, err := f.repo.ReplaceItemACL(context.Background(), hidden.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	f.item(t, ItemInput{Title: "共通 別プロジェクト", Description: "OTHER-PROJECT-BODY", ProjectID: &f.other.ID})
	var search, open string
	chatter := &fakeProjectChatter{fn: func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
		search, _ = run(ctx, ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{"query":"共通"}`)})
		open, _ = run(ctx, ToolCall{Name: toolGetItem, Input: json.RawMessage(fmt.Sprintf(`{"number":%d}`, hidden.Number))})
		return "ok", 1, 1, nil
	}}
	h := NewHandler(f.repo, WithAIChat(chatter))
	if w := requestWithCookie(h, "POST", projectChatPath(1), `{"message":"q"}`, "member-session"); w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	var page searchItemsOut
	if err := json.Unmarshal([]byte(search), &page); err != nil || len(page.Items) != 1 || page.Items[0].Number != mine.Number || page.Total != 1 {
		t.Fatalf("member search=%s", search)
	}
	if open != toolErrorResult(toolErrItemNotFound) || strings.Contains(search+open, "SECRET-BODY") || strings.Contains(search, "OTHER-PROJECT-BODY") {
		t.Fatalf("hidden item leaked: %s %s", search, open)
	}
	// 別プロジェクトの URL なら、そのプロジェクトのアイテムだけ。
	if w := requestWithCookie(h, "POST", projectChatPath(f.other.ID), `{"message":"q"}`, "member-session"); w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	if err := json.Unmarshal([]byte(search), &page); err != nil || len(page.Items) != 1 || page.Items[0].Title != "共通 別プロジェクト" {
		t.Fatalf("other project search=%s", search)
	}
}

// 受け入れ条件 5: 履歴は「プロジェクト × ユーザー」ごと。取得にもクリアにも、他人・他プロジェクトのものは現れない。
func TestProjectAIChatHistoryIsPerProjectAndUser(t *testing.T) {
	f := newToolFixture(t)
	chatter := &fakeProjectChatter{}
	h := NewHandler(f.repo, WithAIChat(chatter))
	send := func(session string, projectID int64, text string) {
		t.Helper()
		chatter.fn = answers("answer to "+text, 1, 1)
		if w := requestWithCookie(h, "POST", projectChatPath(projectID), fmt.Sprintf(`{"message":%q}`, text), session); w.Code != 200 {
			t.Fatalf("%s: %d %s", text, w.Code, w.Body.String())
		}
	}
	send(HandlerTestSessionID, 1, "admin-p1")
	send(HandlerTestSessionID, f.other.ID, "admin-p2")
	send("member-session", 1, "member-p1")
	list := func(session string, projectID int64) []string {
		t.Helper()
		w := requestWithCookie(h, "GET", projectChatPath(projectID), "", session)
		if w.Code != 200 {
			t.Fatalf("GET: %d %s", w.Code, w.Body.String())
		}
		var bodies []string
		for _, m := range decodeProjectChat(t, w).Messages {
			bodies = append(bodies, m.Body)
		}
		return bodies
	}
	if got := list(HandlerTestSessionID, 1); strings.Join(got, "|") != "admin-p1|answer to admin-p1" {
		t.Fatalf("admin p1=%v", got)
	}
	if got := list(HandlerTestSessionID, f.other.ID); strings.Join(got, "|") != "admin-p2|answer to admin-p2" {
		t.Fatalf("admin p2=%v", got)
	}
	if got := list("member-session", 1); strings.Join(got, "|") != "member-p1|answer to member-p1" {
		t.Fatalf("member p1=%v", got)
	}
	// 空の履歴は、空の配列（null ではない）。
	w := requestWithCookie(h, "GET", projectChatPath(f.other.ID), "", "member-session")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"messages":[]`) {
		t.Fatalf("empty history: %d %s", w.Code, w.Body.String())
	}
	// モデルに渡る履歴も、自分のそのプロジェクトの分だけ。
	send("member-session", 1, "member-p1-again")
	for _, turn := range chatter.turns[len(chatter.turns)-1] {
		if strings.Contains(turn.Body, "admin") {
			t.Fatalf("another user's history reached the model: %+v", turn)
		}
	}
	// クリアは、自分のそのプロジェクトの分だけ。
	if w = request(h, "DELETE", projectChatPath(1), ""); w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("DELETE: %d %s", w.Code, w.Body.String())
	}
	if got := list(HandlerTestSessionID, 1); len(got) != 0 {
		t.Fatalf("cleared: %v", got)
	}
	if got := list(HandlerTestSessionID, f.other.ID); len(got) != 2 {
		t.Fatalf("other project must stay: %v", got)
	}
	if got := list("member-session", 1); len(got) != 4 {
		t.Fatalf("other user must stay: %v", got)
	}
}

func TestProjectAIChatGETAndDELETEWorkWithoutAKeyAndCheckTheProject(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo) // no chatter
	if w := request(h, "GET", projectChatPath(1), ""); w.Code != 200 {
		t.Fatalf("GET: %d", w.Code)
	}
	if w := request(h, "DELETE", projectChatPath(1), ""); w.Code != 204 {
		t.Fatalf("DELETE: %d", w.Code)
	}
	for _, method := range []string{"GET", "DELETE", "POST"} {
		body := ""
		if method == "POST" {
			body = `{"message":"q"}`
		}
		if w := requestAnon(h, method, projectChatPath(1), body); w.Code != 401 || decodeError(t, w).Message != msgLoginRequired {
			t.Fatalf("%s anonymous: %d %s", method, w.Code, w.Body.String())
		}
		for _, bad := range []string{"abc", "0", "-1"} {
			w := request(h, method, "/api/projects/"+bad+"/ai-chat", body)
			if e := decodeError(t, w); w.Code != 400 || e.Message != "プロジェクトIDが不正です。" || e.Code != "" {
				t.Fatalf("%s %s: %d %s", method, bad, w.Code, w.Body.String())
			}
		}
		w := request(h, method, projectChatPath(999), body)
		if e := decodeError(t, w); w.Code != 404 || e.Message != "プロジェクトが見つかりません。" || e.Code != "" {
			t.Fatalf("%s missing project: %d %s", method, w.Code, w.Body.String())
		}
	}
}

// 受け入れ条件 6: 開いているアイテムは、閲覧できるときだけ文脈に入る。できなくてもエラーにしない。
func TestProjectAIChatFocusItemIsIncludedOnlyWhenViewable(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	card := f.item(t, ItemInput{Title: "FOCUS-TITLE", Description: "FOCUS-DESCRIPTION"})
	if _, err := f.repo.CreateComment(ctx, card.ID, "a", "FOCUS-COMMENT", 1); err != nil {
		t.Fatal(err)
	}
	chatter := &fakeProjectChatter{fn: answers("ok", 1, 1)}
	h := NewHandler(f.repo, WithAIChat(chatter))
	ask := func(session string, projectID int64, number int64) string {
		t.Helper()
		w := requestWithCookie(h, "POST", projectChatPath(projectID), fmt.Sprintf(`{"message":"これは？","focusItemNumber":%d}`, number), session)
		if w.Code != 200 {
			t.Fatalf("focus %d must not be an error: %d %s", number, w.Code, w.Body.String())
		}
		return chatter.lastSystem()
	}
	system := ask("member-session", 1, card.Number)
	for _, want := range []string{fmt.Sprintf("いま開いているアイテム（#%d）", card.Number), "FOCUS-TITLE", "FOCUS-DESCRIPTION", "FOCUS-COMMENT"} {
		if !strings.Contains(system, want) {
			t.Fatalf("system lacks %q:\n%s", want, system)
		}
	}
	// 付けなければ入らない。
	if w := postProjectChat(h, 1, `{"message":"q"}`); w.Code != 200 || strings.Contains(chatter.lastSystem(), "FOCUS-TITLE") {
		t.Fatalf("no focus: %d", w.Code)
	}
	// focusItemNumber: null は、付けないのと同じ。
	if w := postProjectChat(h, 1, `{"message":"q","focusItemNumber":null}`); w.Code != 200 || strings.Contains(chatter.lastSystem(), "FOCUS-TITLE") {
		t.Fatalf("null focus: %d", w.Code)
	}
	// 存在しない番号・別プロジェクト・閲覧できない・ゴミ箱は、文脈なしで続ける。
	noFocus := func(label, system string) {
		t.Helper()
		if strings.Contains(system, "FOCUS-") || strings.Contains(system, "いま開いているアイテム（#") {
			t.Fatalf("%s: the item must not be in the context:\n%s", label, system)
		}
	}
	noFocus("missing", ask("member-session", 1, 9999))
	noFocus("other project", ask("member-session", f.other.ID, card.Number))
	if _, err := f.repo.ReplaceItemACL(ctx, card.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	noFocus("hidden", ask("member-session", 1, card.Number))
	if system = ask(HandlerTestSessionID, 1, card.Number); !strings.Contains(system, "FOCUS-TITLE") {
		t.Fatal("admin may view the restricted item")
	}
	if err := f.repo.DeleteItem(ctx, card.ID); err != nil {
		t.Fatal(err)
	}
	noFocus("trashed", ask(HandlerTestSessionID, 1, card.Number))
}

// 「無い」と「失敗」を混ぜない: 開いているアイテムの読み込みの失敗は、文脈なしに流さない。
func TestProjectAIChatFocusLoadFailureFailsTheRequest(t *testing.T) {
	boom := errors.New("db down SENTINEL-SQL")
	cases := map[string]func(*failingToolRepo){
		"item":     func(r *failingToolRepo) { r.getErr = boom },
		"acl":      func(r *failingToolRepo) { r.aclListFail = boom },
		"comments": func(r *failingToolRepo) { r.commentsErr = boom },
	}
	for label, prepare := range cases {
		t.Run(label, func(t *testing.T) {
			f := newToolFixture(t)
			card := f.item(t, ItemInput{Title: "t"})
			if _, err := f.repo.ReplaceItemACL(context.Background(), card.ID, ViewAccessRestricted, EditAccessOpen, nil, nil); err != nil {
				t.Fatal(err)
			}
			repo := &failingToolRepo{memoryRepo: f.repo}
			prepare(repo)
			chatter := &fakeProjectChatter{fn: answers("must not run", 1, 1)}
			lim := &countingAIRateLimiter{allow: true}
			h := NewHandler(repo, WithAIChat(chatter), WithAIRateLimiter(lim))
			w := postProjectChat(h, 1, fmt.Sprintf(`{"message":"q","focusItemNumber":%d}`, card.Number))
			if w.Code != 500 || strings.Contains(w.Body.String(), "SENTINEL") || chatter.callCount() != 0 {
				t.Fatalf("status=%d body=%s calls=%d", w.Code, w.Body.String(), chatter.callCount())
			}
			if tries, releases := lim.counts(); tries != 1 || releases != 1 {
				t.Fatalf("the reservation must be given back: tries=%d releases=%d", tries, releases)
			}
			if got := projectHistory(t, repo, 1, f.admin.ID); len(got) != 0 {
				t.Fatalf("history=%v", got)
			}
		})
	}
}

// 受け入れ条件 7: エラーの順序と形。
func TestProjectAIChatPOSTErrorOrderAndShape(t *testing.T) {
	repo := fresh()
	chatter := &fakeProjectChatter{fn: answers("ok", 1, 1)}
	configured := NewHandler(repo, WithAIChat(chatter))
	notConfigured := NewHandler(repo)
	send := func(h http.Handler, session, contentType, target, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", target, strings.NewReader(body))
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		if session != "" {
			r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: session})
		}
		h.ServeHTTP(w, r)
		return w
	}
	const admin = HandlerTestSessionID
	long := strings.Repeat("あ", maxAIChatMessageLen+1)
	cases := []struct {
		name                       string
		h                          http.Handler
		session, contentType, path string
		body                       string
		status                     int
		code                       string
	}{
		// 0. 未ログインは、ほかのどの検査よりも先。
		{"401 before 415", configured, "", "text/plain", "/api/projects/abc/ai-chat", `not json`, 401, ""},
		// 1. Content-Type。
		{"415 before 400", configured, admin, "text/plain", "/api/projects/abc/ai-chat", `{"message":""}`, 415, "unsupported_media_type"},
		{"415 without content type", configured, admin, "", projectChatPath(1), `{"message":"q"}`, 415, "unsupported_media_type"},
		// 2. 本文（プロジェクトの検査より先）。
		{"400 broken json", configured, admin, "application/json", projectChatPath(999), `{`, 400, ""},
		{"400 unknown field", configured, admin, "application/json", projectChatPath(999), `{"message":"q","extra":1}`, 400, ""},
		{"400 empty message", configured, admin, "application/json", projectChatPath(999), `{"message":"  "}`, 400, ""},
		{"400 long message", configured, admin, "application/json", projectChatPath(999), `{"message":` + strconv.Quote(long) + `}`, 400, ""},
		{"400 control char", configured, admin, "application/json", projectChatPath(999), `{"message":"a\u0000b"}`, 400, ""},
		{"400 focus zero", configured, admin, "application/json", projectChatPath(999), `{"message":"q","focusItemNumber":0}`, 400, ""},
		{"400 focus negative", configured, admin, "application/json", projectChatPath(999), `{"message":"q","focusItemNumber":-2}`, 400, ""},
		{"400 focus string", configured, admin, "application/json", projectChatPath(999), `{"message":"q","focusItemNumber":"12"}`, 400, ""},
		{"400 focus fraction", configured, admin, "application/json", projectChatPath(999), `{"message":"q","focusItemNumber":1.5}`, 400, ""},
		// 3. プロジェクト（未設定の 503 より先）。
		{"400 project id", notConfigured, admin, "application/json", "/api/projects/abc/ai-chat", `{"message":"q"}`, 400, ""},
		{"404 project", notConfigured, admin, "application/json", projectChatPath(999), `{"message":"q"}`, 404, ""},
		// 4. 未設定。
		{"503", notConfigured, admin, "application/json; charset=utf-8", projectChatPath(1), `{"message":"q"}`, 503, "ai_not_configured"},
	}
	for _, tc := range cases {
		w := send(tc.h, tc.session, tc.contentType, tc.path, tc.body)
		e := decodeError(t, w)
		if w.Code != tc.status || e.Code != tc.code || e.Message == "" {
			t.Fatalf("%s: status=%d body=%s", tc.name, w.Code, w.Body.String())
		}
	}
	if chatter.callCount() != 0 {
		t.Fatalf("the model must not be called: %d", chatter.callCount())
	}
	if usage, _ := repo.GetAIUsage(context.Background()); usage.RequestCount != 0 {
		t.Fatalf("usage=%+v", usage)
	}
}

func TestProjectAIChatNeedsAChatterThatCanUseTools(t *testing.T) {
	repo := fresh()
	itemOnly := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) { return "ok", 1, 1, nil }}
	h := NewHandler(repo, WithAIChat(itemOnly))
	if w := postProjectChat(h, 1, `{"message":"q"}`); w.Code != 503 || decodeError(t, w).Code != "ai_not_configured" {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
}

// 受け入れ条件 7: 503 → クレジット → 回数制限 → 429 ai_busy の順。
func TestProjectAIChatCreditRateAndBusyOrder(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	chatter := &fakeProjectChatter{fn: answers("ok", 1, 1)}
	lim := &countingAIRateLimiter{allow: false}
	block := make(chan struct{})
	formatter := &fakeFormatter{fn: func(context.Context, Draft) (RefinedItem, int64, int64, error) {
		<-block
		// A local invalid_request is not billed, so the blocked requests do not write usage at the same time.
		return RefinedItem{}, 0, 0, chatFail{kind: "invalid_request", status: 0}
	}}
	h := NewHandler(repo, WithAIChat(chatter), WithItemFormatter(formatter), WithAIRateLimiter(lim))

	// クレジットの上限は、回数制限より先（予約を消費しない）。
	zero := int64(0)
	if err := repo.SetAICreditLimit(context.Background(), &zero); err != nil {
		t.Fatal(err)
	}
	if w := postProjectChat(h, 1, `{"message":"q"}`); w.Code != 429 || decodeError(t, w).Code != "ai_credit_limit" {
		t.Fatalf("credit: %d %s", w.Code, w.Body.String())
	}
	if tries, _ := lim.counts(); tries != 0 {
		t.Fatalf("credit limit must come before the rate limit: tries=%d", tries)
	}
	if err := repo.SetAICreditLimit(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	// 回数制限。
	w := postProjectChat(h, 1, `{"message":"q"}`)
	if e := decodeError(t, w); w.Code != 429 || e.Code != "ai_rate_limit" || e.Message != msgAIRateLimit {
		t.Fatalf("rate: %d %s", w.Code, w.Body.String())
	}
	// 共有の枠が埋まっていれば 429 ai_busy。予約は返す。
	lim.mu.Lock()
	lim.allow, lim.tries, lim.release = true, 0, 0
	lim.mu.Unlock()
	var wg sync.WaitGroup
	for range maxConcurrentFormats {
		wg.Add(1)
		go func() { defer wg.Done(); postJSON(h, `{"title":"下書きタイトルです"}`) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for formatter.callCount() < maxConcurrentFormats {
		if time.Now().After(deadline) {
			t.Fatal("formatter calls did not start")
		}
		time.Sleep(time.Millisecond)
	}
	w = postProjectChat(h, 1, `{"message":"q"}`)
	if e := decodeError(t, w); w.Code != 429 || e.Code != "ai_busy" || e.Message != msgAIBusy {
		t.Fatalf("busy: %d %s", w.Code, w.Body.String())
	}
	if tries, releases := lim.counts(); tries != maxConcurrentFormats+1 || releases != 1 {
		t.Fatalf("busy must give the reservation back: tries=%d releases=%d", tries, releases)
	}
	close(block)
	wg.Wait()
	if chatter.callCount() != 0 {
		t.Fatalf("model calls=%d", chatter.callCount())
	}
	// 枠が空けば使える（弾かれたあとに、同じユーザーの実行中の印が残っていない）。
	if w = postProjectChat(h, 1, `{"message":"q"}`); w.Code != 200 {
		t.Fatalf("after release: %d %s", w.Code, w.Body.String())
	}
}

// 受け入れ条件 7: モデルの失敗は 502 ai_failed。上流の文言は出さず、履歴にも足さない。
func TestProjectAIChatModelFailureIs502AndStoresNothing(t *testing.T) {
	for _, kind := range []string{"timeout", "server", "refusal", "truncated", "invalid_output"} {
		t.Run(kind, func(t *testing.T) {
			repo := fresh()
			chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
				return "SENTINEL-PARTIAL", 9, 2, chatFail{kind: kind, status: 500}
			}}
			lim := &countingAIRateLimiter{allow: true}
			h := NewHandler(repo, WithAIChat(chatter), WithAIRateLimiter(lim))
			w := postProjectChat(h, 1, `{"message":"q"}`)
			e := decodeError(t, w)
			if w.Code != 502 || e.Code != "ai_failed" || e.Message != "AIチャットに失敗しました。時間をおいて再試行してください。" {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "SENTINEL") || strings.Contains(w.Body.String(), kind) {
				t.Fatalf("upstream detail leaked: %s", w.Body.String())
			}
			if got := projectHistory(t, repo, 1, 1); len(got) != 0 {
				t.Fatalf("history=%v", got)
			}
			// モデルを呼んだあとの失敗は、回数制限の 1 回分として数える（予約を返さない）。
			if tries, releases := lim.counts(); tries != 1 || releases != 0 {
				t.Fatalf("tries=%d releases=%d", tries, releases)
			}
		})
	}
}

type projectAppendFailRepo struct {
	*memoryRepo
}

func (r *projectAppendFailRepo) AppendProjectAITurn(context.Context, int64, int64, string, string, int64, int64) error {
	return errors.New("append failed SENTINEL-SQL")
}

func TestProjectAIChatAppendFailureIs500WithCodeAndStillCountsUsage(t *testing.T) {
	repo := &projectAppendFailRepo{memoryRepo: fresh()}
	chatter := &fakeProjectChatter{fn: answers("ok", 7, 8)}
	h := NewHandler(repo, WithAIChat(chatter))
	w := postProjectChat(h, 1, `{"message":"q"}`)
	if e := decodeError(t, w); w.Code != 500 || e.Code != "server_error" || strings.Contains(w.Body.String(), "SENTINEL") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if usage, _ := repo.GetAIUsage(context.Background()); usage.RequestCount != 1 || usage.InputTokens != 7 || usage.OutputTokens != 8 {
		t.Fatalf("usage=%+v", usage)
	}
}

// 受け入れ条件 13: ツールの中の DB の失敗は、回答にならずにリクエストの失敗になる。
func TestProjectAIChatToolFailureFailsTheRequest(t *testing.T) {
	boom := errors.New("SELECT failed SENTINEL-SQL /var/lib/mysql")
	chatters := map[string]projectChatFn{
		// ふつうの実装: ツールの失敗をそのまま返す。
		"returns the tool error": func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
			if _, err := run(ctx, ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{"query":"x"}`)}); err != nil {
				return "", 21, 5, err
			}
			return "must not happen", 0, 0, nil
		},
		// 失敗を無視して答えを作る実装でも、回答として保存しない。
		"ignores the tool error": func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
			_, _ = run(ctx, ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{"query":"x"}`)})
			return "該当するアイテムはありません。", 21, 5, nil
		},
	}
	for label, fn := range chatters {
		t.Run(label, func(t *testing.T) {
			repo := &failingToolRepo{memoryRepo: fresh(), searchErr: boom}
			chatter := &fakeProjectChatter{fn: fn}
			h := NewHandler(repo, WithAIChat(chatter))
			w := postProjectChat(h, 1, `{"message":"x はある？"}`)
			e := decodeError(t, w)
			if w.Code != 500 || e.Code != "server_error" {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			for _, leak := range []string{"SENTINEL", "SELECT", "mysql", "該当するアイテムはありません"} {
				if strings.Contains(w.Body.String(), leak) {
					t.Fatalf("leaked %q: %s", leak, w.Body.String())
				}
			}
			if got := projectHistory(t, repo, 1, 1); len(got) != 0 {
				t.Fatalf("history=%v", got)
			}
			// 済んだ回の実数は記録する。
			if usage, _ := repo.GetAIUsage(context.Background()); usage.RequestCount != 1 || usage.InputTokens != 21 || usage.OutputTokens != 5 {
				t.Fatalf("usage=%+v", usage)
			}
		})
	}
}

func TestProjectAIChatToolTimeoutIs502(t *testing.T) {
	repo := &failingToolRepo{memoryRepo: fresh(), searchErr: fmt.Errorf("search project items: %w", context.DeadlineExceeded)}
	chatter := &fakeProjectChatter{fn: func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
		_, err := run(ctx, ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{}`)})
		return "", 3, 1, err
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	w := postProjectChat(h, 1, `{"message":"q"}`)
	if w.Code != 502 || decodeError(t, w).Code != "ai_failed" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if got := projectHistory(t, repo, 1, 1); len(got) != 0 {
		t.Fatalf("history=%v", got)
	}
}

// usageCtxRepo fails AddAIUsage when its context is already cancelled, like a real database would.
type usageCtxRepo struct {
	*memoryRepo
	mu       sync.Mutex
	deadline time.Duration
	hadLimit bool
}

func (r *usageCtxRepo) AddAIUsage(ctx context.Context, requests, inTok, outTok int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	if d, ok := ctx.Deadline(); ok {
		r.hadLimit, r.deadline = true, time.Until(d)
	}
	r.mu.Unlock()
	return r.memoryRepo.AddAIUsage(ctx, requests, inTok, outTok)
}

// 受け入れ条件 14: 失敗・時間切れでも合計を記録する。クライアントが切断しても記録する。
func TestProjectAIChatRecordsUsageEvenWhenTheClientIsGone(t *testing.T) {
	repo := &usageCtxRepo{memoryRepo: fresh()}
	ctx, cancel := context.WithCancel(context.Background())
	chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		cancel() // the client disconnects while the model is working
		// 1〜2 回目の実数と、時間切れになった 3 回目の見積もりの合計。
		return "", 1200, 80, chatFail{kind: "timeout"}
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(`{"message":"q"}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	h.ServeHTTP(w, r)
	if w.Code != 502 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	usage, _ := repo.memoryRepo.GetAIUsage(context.Background())
	if usage.RequestCount != 1 || usage.InputTokens != 1200 || usage.OutputTokens != 80 {
		t.Fatalf("usage must be recorded although the request context is cancelled: %+v", usage)
	}
	if !repo.hadLimit || repo.deadline > projectChatUsageRecordTimeout || repo.deadline <= 0 {
		t.Fatalf("recording must have its own short time limit: %v %v", repo.hadLimit, repo.deadline)
	}
}

func TestProjectAIChatFailureWithoutAnyUsageIsEstimated(t *testing.T) {
	repo := fresh()
	chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		return "", 0, 0, chatFail{kind: "timeout"}
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	if w := postProjectChat(h, 1, `{"message":"質問です"}`); w.Code != 502 {
		t.Fatalf("status=%d", w.Code)
	}
	usage, _ := repo.GetAIUsage(context.Background())
	if usage.RequestCount != 1 || usage.InputTokens <= 0 || usage.OutputTokens != 0 {
		t.Fatalf("usage=%+v", usage)
	}
	// サーバー内で弾いた不正な呼び出し（上流に送っていない）は数えない。
	chatter.fn = func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		return "", 0, 0, chatFail{kind: "invalid_request", status: 0}
	}
	if w := postProjectChat(h, 1, `{"message":"質問です"}`); w.Code != 502 {
		t.Fatalf("status=%d", w.Code)
	}
	if after, _ := repo.GetAIUsage(context.Background()); after != usage {
		t.Fatalf("local invalid_request must not be billed: %+v", after)
	}
}

// 受け入れ条件 16: 同じユーザーの同時実行は 1 つ。2 つ目は 429 ai_busy で、回数制限の予約を消費しない。
func TestProjectAIChatAllowsOneRunningChatPerUser(t *testing.T) {
	f := newToolFixture(t)
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		started <- struct{}{}
		<-release
		return "ok", 1, 1, nil
	}}
	lim := &countingAIRateLimiter{allow: true}
	h := NewHandler(f.repo, WithAIChat(chatter), WithAIRateLimiter(lim))
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() { done <- postProjectChat(h, 1, `{"message":"1 つ目"}`) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("the first chat did not start")
	}
	// 同じユーザーの 2 つ目（別のプロジェクトでも）は弾く。
	for _, projectID := range []int64{1, f.other.ID} {
		w := postProjectChat(h, projectID, `{"message":"2 つ目"}`)
		if e := decodeError(t, w); w.Code != 429 || e.Code != "ai_busy" {
			t.Fatalf("second chat: %d %s", w.Code, w.Body.String())
		}
	}
	if tries, releases := lim.counts(); tries != 1 || releases != 0 {
		t.Fatalf("a rejected second chat must not touch the rate limit: tries=%d releases=%d", tries, releases)
	}
	if chatter.callCount() != 1 {
		t.Fatalf("model calls=%d", chatter.callCount())
	}
	// 別のユーザーは、同時に使える。
	go func() {
		done <- requestWithCookie(h, "POST", projectChatPath(f.other.ID), `{"message":"別の人"}`, "member-session")
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("another user's chat must be allowed to start")
	}
	// 1 つずつ終わらせる（テスト用のリポジトリは、同時の書き込みに対応していない）。
	for range 2 {
		release <- struct{}{}
		if w := <-done; w.Code != 200 {
			t.Fatalf("running chat: %d %s", w.Code, w.Body.String())
		}
	}
	// 終われば、また送れる。
	chatter.fn = answers("ok", 1, 1)
	if w := postProjectChat(h, 1, `{"message":"3 つ目"}`); w.Code != 200 {
		t.Fatalf("after the first finished: %d %s", w.Code, w.Body.String())
	}
}

func TestProjectChatContextLimits(t *testing.T) {
	// リクエストに期限が無ければ、40 秒。
	ctx, cancel, ok := projectChatContext(context.Background())
	deadline, _ := ctx.Deadline()
	cancel()
	if left := time.Until(deadline); !ok || left > maxProjectChatDuration || left < maxProjectChatDuration-time.Second {
		t.Fatalf("no request deadline: %v", left)
	}
	// 50 秒のリクエストでも、40 秒まで。
	parent, stop := context.WithTimeout(context.Background(), ProjectChatRequestTimeout)
	ctx, cancel, ok = projectChatContext(parent)
	deadline, _ = ctx.Deadline()
	cancel()
	stop()
	if left := time.Until(deadline); !ok || left > maxProjectChatDuration || left < maxProjectChatDuration-time.Second {
		t.Fatalf("50s request: %v", left)
	}
	// 残りが少なければ、モデルの後の仕事（利用量の記録 + 回答の保存）の分を引いた値。
	afterModel := projectChatAfterModelReserve
	parent, stop = context.WithTimeout(context.Background(), 10*time.Second)
	ctx, cancel, ok = projectChatContext(parent)
	deadline, _ = ctx.Deadline()
	cancel()
	stop()
	if left := time.Until(deadline); !ok || left > 10*time.Second-afterModel || left < 10*time.Second-afterModel-time.Second {
		t.Fatalf("10s request: %v", left)
	}
	// モデルの後の分も残っていなければ、呼ばない（保存の 3 秒だけでは足りない）。
	parent, stop = context.WithTimeout(context.Background(), afterModel-time.Second)
	_, cancel, ok = projectChatContext(parent)
	cancel()
	stop()
	if ok {
		t.Fatal("no time left for the model")
	}
}

// モデルの後には、利用量の記録と回答の保存が、それぞれの期限で順に走る。両方が期限いっぱい
// かかっても、リクエストの制限（503）より前に終わること。
func TestProjectChatKeepsTimeForUsageAndStoringAfterTheModel(t *testing.T) {
	if projectChatAfterModelReserve != projectChatUsageRecordTimeout+projectChatStoreTimeout {
		t.Fatalf("reserve=%v usage=%v store=%v", projectChatAfterModelReserve, projectChatUsageRecordTimeout, projectChatStoreTimeout)
	}
	if projectChatUsageRecordTimeout <= 0 || projectChatStoreTimeout <= 0 {
		t.Fatal("both steps need time")
	}
	if maxProjectChatDuration+projectChatAfterModelReserve >= ProjectChatRequestTimeout {
		t.Fatalf("chat %v + after-model %v must stay below the request timeout %v", maxProjectChatDuration, projectChatAfterModelReserve, ProjectChatRequestTimeout)
	}
	if createReserve != 3*time.Second {
		t.Fatalf("createReserve is shared with other features and must not change: %v", createReserve)
	}
}

func TestProjectAIChatWithoutTimeLeftIs502AndGivesTheReservationBack(t *testing.T) {
	repo := fresh()
	chatter := &fakeProjectChatter{fn: answers("must not run", 1, 1)}
	lim := &countingAIRateLimiter{allow: true}
	h := NewHandler(repo, WithAIChat(chatter), WithAIRateLimiter(lim))
	ctx, cancel := context.WithTimeout(context.Background(), projectChatAfterModelReserve-time.Second)
	defer cancel()
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(`{"message":"q"}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	h.ServeHTTP(w, r)
	if w.Code != 502 || decodeError(t, w).Code != "ai_failed" || chatter.callCount() != 0 {
		t.Fatalf("status=%d body=%s calls=%d", w.Code, w.Body.String(), chatter.callCount())
	}
	if tries, releases := lim.counts(); tries != 1 || releases != 1 {
		t.Fatalf("tries=%d releases=%d", tries, releases)
	}
}

// 既存のアイテム単位のチャットは、ProjectChatter も実装したチャットでも、これまでどおり動く。
func TestItemAIChatStillWorksNextToTheProjectChat(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeProjectChatter{fn: answers("project", 1, 1)}
	h := NewHandler(repo, WithAIChat(chatter))
	w := request(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "item chat") {
		t.Fatalf("item chat: %d %s", w.Code, w.Body.String())
	}
	if list, _ := repo.ListAIMessages(context.Background(), card.ID); len(list) != 2 {
		t.Fatalf("item history=%d", len(list))
	}
	if got := projectHistory(t, repo, 1, 1); len(got) != 0 {
		t.Fatalf("the item chat must not write the project history: %v", got)
	}
}

// appendCtxRepo refuses to store a turn on a cancelled context, as a real database does.
type appendCtxRepo struct {
	*memoryRepo
}

func (r *appendCtxRepo) AppendProjectAITurn(ctx context.Context, projectID, userID int64, userBody, assistantBody string, inTok, outTok int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, ok := ctx.Deadline(); !ok {
		return errors.New("storing the answer must have a time limit")
	}
	return r.memoryRepo.AppendProjectAITurn(ctx, projectID, userID, userBody, assistantBody, inTok, outTok)
}

func TestProjectAIChatStoresTheAnswerEvenWhenTheClientIsGone(t *testing.T) {
	repo := &appendCtxRepo{memoryRepo: fresh()}
	ctx, cancel := context.WithCancel(context.Background())
	chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		cancel() // the client disconnects while the model is working
		return "回答", 100, 10, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(`{"message":"q"}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	h.ServeHTTP(w, r)
	list, err := repo.memoryRepo.ListProjectAIMessages(context.Background(), 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	// 使った分は数えられるので、回答も残す（開き直せば読める）。
	if len(list) != 2 || list[1].Body != "回答" {
		t.Fatalf("the paid answer must be stored although the client is gone: status=%d %+v", w.Code, list)
	}
}

func TestProjectAIChatKeepsAskingAfterTheClientIsGone(t *testing.T) {
	repo := &appendCtxRepo{memoryRepo: fresh()}
	ctx, cancel := context.WithCancel(context.Background())
	chatter := &fakeProjectChatter{fn: func(chatCtx context.Context, _ string, _ []ChatTurn, _ ToolRunner) (string, int64, int64, error) {
		cancel() // the user closes the panel while the model is still working
		if err := chatCtx.Err(); err != nil {
			return "", 0, 0, chatFail{kind: "timeout"}
		}
		if _, ok := chatCtx.Deadline(); !ok {
			return "", 0, 0, errors.New("the model call must keep its time limit")
		}
		return "回答", 100, 10, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", projectChatPath(1), strings.NewReader(`{"message":"q"}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	h.ServeHTTP(w, r)
	list, err := repo.memoryRepo.ListProjectAIMessages(context.Background(), 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	// 閉じても質問は捨てない。開き直せば、質問と回答が履歴にある。
	if len(list) != 2 || list[1].Body != "回答" {
		t.Fatalf("closing the panel must not drop the question: status=%d %+v", w.Code, list)
	}
}

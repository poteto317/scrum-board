package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestProjectChatTargetOf(t *testing.T) {
	seven := int64(7)
	cases := []struct {
		name string
		req  projectAIChatRequest
		want projectChatTarget
	}{
		{"nothing given continues the latest", projectAIChatRequest{}, projectChatTargetLatest},
		{"newConversation false is nothing given", projectAIChatRequest{NewConversation: false}, projectChatTargetLatest},
		{"newConversation", projectAIChatRequest{NewConversation: true}, projectChatTargetNew},
		{"conversationId", projectAIChatRequest{ConversationID: &seven}, projectChatTargetNamed},
	}
	for _, tc := range cases {
		if got := projectChatTargetOf(tc.req); got != tc.want {
			t.Errorf("%s: got %d want %d", tc.name, got, tc.want)
		}
	}
}

func TestProjectChatConversationID(t *testing.T) {
	if projectChatConversationID(nil) != nil {
		t.Fatal("a new conversation has no id")
	}
	if id := projectChatConversationID(&ProjectAIConversation{ID: 9}); id == nil || *id != 9 {
		t.Fatalf("id=%v", id)
	}
}

// 代替の応答に付ける「前の履歴」は、保存先が、履歴を読んだ会話と同じときだけ。
func TestProjectChatHistoryInStored(t *testing.T) {
	before := []ProjectAIMessage{{ID: 1, ConversationID: 5}, {ID: 2, ConversationID: 5}}
	five, six := int64(5), int64(6)
	if got := projectChatHistoryInStored(5, &five, before); len(got) != 2 {
		t.Fatalf("same conversation keeps the history: %+v", got)
	}
	// 消された会話の代わりに新しい会話に保存された: 消された会話のメッセージを付けない。
	if got := projectChatHistoryInStored(5, &six, before); len(got) != 0 {
		t.Fatalf("another conversation: %+v", got)
	}
	// 新しい会話（履歴を読んでいない）。
	if got := projectChatHistoryInStored(5, nil, before); len(got) != 0 {
		t.Fatalf("new conversation: %+v", got)
	}
}

type conversationLookupFailRepo struct {
	*memoryRepo
	getErr, latestErr error
}

func (r *conversationLookupFailRepo) GetProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) (ProjectAIConversation, error) {
	if r.getErr != nil {
		return ProjectAIConversation{}, r.getErr
	}
	return r.memoryRepo.GetProjectAIConversation(ctx, projectID, userID, conversationID)
}

func (r *conversationLookupFailRepo) LatestProjectAIConversation(ctx context.Context, projectID, userID int64) (*ProjectAIConversation, error) {
	if r.latestErr != nil {
		return nil, r.latestErr
	}
	return r.memoryRepo.LatestProjectAIConversation(ctx, projectID, userID)
}

func TestResolveProjectChatConversation(t *testing.T) {
	ctx := context.Background()
	repo := &conversationLookupFailRepo{memoryRepo: fresh()}
	h := handler{repo: repo}
	resolve := func(req projectAIChatRequest) (*ProjectAIConversation, bool, *httptest.ResponseRecorder) {
		w := httptest.NewRecorder()
		c, ok := h.resolveProjectChatConversation(w, httptest.NewRequest("POST", projectChatPath(1), nil), 1, 7, req)
		return c, ok, w
	}
	// 会話が無ければ、指定なしは「新しい会話」。
	if c, ok, _ := resolve(projectAIChatRequest{}); !ok || c != nil {
		t.Fatalf("no conversation yet: %+v %v", c, ok)
	}
	first, err := repo.AppendProjectAITurn(ctx, 1, 7, nil, ProjectAITurn{Title: "first", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.AppendProjectAITurn(ctx, 1, 7, nil, ProjectAITurn{Title: "second", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	if c, ok, _ := resolve(projectAIChatRequest{}); !ok || c == nil || c.ID != second.ID {
		t.Fatalf("nothing given is the latest: %+v", c)
	}
	if c, ok, _ := resolve(projectAIChatRequest{ConversationID: &first.ID}); !ok || c == nil || c.ID != first.ID {
		t.Fatalf("named: %+v", c)
	}
	if c, ok, _ := resolve(projectAIChatRequest{NewConversation: true}); !ok || c != nil {
		t.Fatalf("new: %+v", c)
	}
	// 見つからない会話は、会話の 404（アイテムの 404 の文言ではない）。
	missing := int64(999)
	if _, ok, w := resolve(projectAIChatRequest{ConversationID: &missing}); ok || w.Code != 404 || decodeError(t, w).Message != "会話が見つかりません。" {
		t.Fatalf("missing: %d %s", w.Code, w.Body.String())
	}
	// 読み込みの失敗は、「無い」にも「新しい会話」にもしない。
	repo.getErr = errors.New("db down SENTINEL-SQL")
	if _, ok, w := resolve(projectAIChatRequest{ConversationID: &first.ID}); ok || w.Code != 500 {
		t.Fatalf("lookup failure: %d %s", w.Code, w.Body.String())
	}
	repo.latestErr = errors.New("db down SENTINEL-SQL")
	if c, ok, w := resolve(projectAIChatRequest{}); ok || c != nil || w.Code != 500 {
		t.Fatalf("latest failure must not become a new conversation: %d %s", w.Code, w.Body.String())
	}
}

// conversationFixture sends project chat messages as the admin or the member and reads the
// conversation routes back.
type conversationFixture struct {
	*toolFixture
	t       *testing.T
	chatter *fakeProjectChatter
	h       http.Handler
}

func newConversationFixture(t *testing.T) *conversationFixture {
	t.Helper()
	f := newToolFixture(t)
	chatter := &fakeProjectChatter{}
	return &conversationFixture{toolFixture: f, t: t, chatter: chatter, h: NewHandler(f.repo, WithAIChat(chatter))}
}

// send posts body (the JSON fields after "message") and returns the reply of a 200.
func (f *conversationFixture) send(session string, projectID int64, message, fields string) projectChatReply {
	f.t.Helper()
	f.chatter.mu.Lock()
	f.chatter.fn = answers("answer to "+message, 1, 1)
	f.chatter.mu.Unlock()
	body := fmt.Sprintf(`{"message":%q%s}`, message, fields)
	w := requestWithCookie(f.h, "POST", projectChatPath(projectID), body, session)
	if w.Code != 200 {
		f.t.Fatalf("POST %s: %d %s", body, w.Code, w.Body.String())
	}
	out := decodeProjectChat(f.t, w)
	if out.Conversation == nil || out.Conversation.ID == 0 || out.Conversation.ProjectID != projectID {
		f.t.Fatalf("the reply must carry the conversation: %s", w.Body.String())
	}
	for _, m := range out.Messages {
		if m.ConversationID != out.Conversation.ID {
			f.t.Fatalf("message of another conversation in the reply: %+v", m)
		}
	}
	if out.Assistant.ConversationID != out.Conversation.ID {
		f.t.Fatalf("assistant=%+v", out.Assistant)
	}
	return out
}

func (f *conversationFixture) lastTurns() []string {
	f.chatter.mu.Lock()
	defer f.chatter.mu.Unlock()
	var out []string
	for _, turn := range f.chatter.turns[len(f.chatter.turns)-1] {
		out = append(out, turn.Body)
	}
	return out
}

func withConversation(id int64) string {
	return fmt.Sprintf(`,"conversationId":%d`, id)
}

const withNewConversation = `,"newConversation":true`

// 受け入れ条件 1: newConversation で新しい会話。どちらも付けなければ、いちばん新しい会話に続く（無ければ作る）。両方は 400。
func TestProjectAIChatNewConversationLatestAndBoth(t *testing.T) {
	f := newConversationFixture(t)
	const admin = HandlerTestSessionID

	// 会話が無いときに、どちらも付けずに送ると、新しく作られる。タイトルは最初のメッセージから。
	first := f.send(admin, 1, "  認証の   方式を\n決めたい ", "")
	if first.Conversation.Title != "認証の 方式を 決めたい" || len(first.Messages) != 2 || first.Messages[1].ID != first.Assistant.ID {
		t.Fatalf("first=%+v messages=%+v", first.Conversation, first.Messages)
	}
	if first.Conversation.CreatedAt.IsZero() || first.Conversation.UpdatedAt.Before(first.Conversation.CreatedAt) {
		t.Fatalf("times=%+v", first.Conversation)
	}
	// どちらも付けなければ、いちばん新しい会話に続く（タイトルは変わらない）。
	again := f.send(admin, 1, "続き", "")
	if again.Conversation.ID != first.Conversation.ID || again.Conversation.Title != first.Conversation.Title || len(again.Messages) != 4 {
		t.Fatalf("continuing the latest: %+v n=%d", again.Conversation, len(again.Messages))
	}
	// conversationId: null・newConversation: false は、付けないのと同じ。
	if got := f.send(admin, 1, "null", `,"conversationId":null,"newConversation":false`); got.Conversation.ID != first.Conversation.ID || len(got.Messages) != 6 {
		t.Fatalf("null and false: %+v", got.Conversation)
	}
	// newConversation: true は、前の会話を残したまま新しい会話。40 文字を超えるタイトルは切る。
	long := strings.Repeat("長", 45)
	second := f.send(admin, 1, long, withNewConversation)
	if second.Conversation.ID == first.Conversation.ID || second.Conversation.Title != strings.Repeat("長", 40)+"…" || len(second.Messages) != 2 {
		t.Fatalf("second=%+v n=%d", second.Conversation, len(second.Messages))
	}
	if got := f.lastTurns(); len(got) != 1 || got[0] != long {
		t.Fatalf("a new conversation starts without history: %v", got)
	}
	if got := f.listIDs(admin, 1); !slices.Equal(got, []int64{second.Conversation.ID, first.Conversation.ID}) {
		t.Fatalf("both conversations stay: %v", got)
	}
	// 以後、どちらも付けなければ、新しいほうに続く。
	if got := f.send(admin, 1, "どっち", ""); got.Conversation.ID != second.Conversation.ID || len(got.Messages) != 4 {
		t.Fatalf("latest is the second: %+v", got.Conversation)
	}

	// 両方を付けると 400。モデルは呼ばない。何も保存しない。
	calls, stored := f.chatter.callCount(), len(projectHistory(t, f.repo, 1, f.admin.ID))
	w := request(f.h, "POST", projectChatPath(1), fmt.Sprintf(`{"message":"q","conversationId":%d,"newConversation":true}`, first.Conversation.ID))
	if e := decodeError(t, w); w.Code != 400 || e.Message != "conversationId と newConversation は同時に指定できません。" || e.Code != "" {
		t.Fatalf("both: %d %s", w.Code, w.Body.String())
	}
	// 0 以下の ID は、本文の検査で 400（プロジェクトの検査より先）。
	for _, bad := range []string{"0", "-1"} {
		w = request(f.h, "POST", projectChatPath(999), `{"message":"q","conversationId":`+bad+`}`)
		if e := decodeError(t, w); w.Code != 400 || e.Message != "会話IDが不正です。" || e.Code != "" {
			t.Fatalf("conversationId %s: %d %s", bad, w.Code, w.Body.String())
		}
	}
	// 整数でない値は、既存の decode の 400。
	for _, bad := range []string{`"7"`, `1.5`, `true`} {
		w = request(f.h, "POST", projectChatPath(1), `{"message":"q","conversationId":`+bad+`}`)
		if e := decodeError(t, w); w.Code != 400 || e.Message != "入力を確認してください。有効なJSONが必要です。" {
			t.Fatalf("conversationId %s: %d %s", bad, w.Code, w.Body.String())
		}
	}
	if f.chatter.callCount() != calls || len(projectHistory(t, f.repo, 1, f.admin.ID)) != stored {
		t.Fatal("a rejected request must not call the model or store anything")
	}
}

// 応答の形: conversation は {id, projectId, title, createdAt, updatedAt}、メッセージには conversationId が付く。ユーザー ID は出さない。
func TestProjectAIChatReplyShape(t *testing.T) {
	f := newConversationFixture(t)
	f.chatter.fn = answers("a", 1, 1)
	w := request(f.h, "POST", projectChatPath(1), `{"message":"q","newConversation":true}`)
	if w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	var raw struct {
		Conversation map[string]any   `json:"conversation"`
		Assistant    map[string]any   `json:"assistant"`
		Messages     []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	keys := func(m map[string]any) string {
		var out []string
		for k := range m {
			out = append(out, k)
		}
		slices.Sort(out)
		return strings.Join(out, ",")
	}
	if got := keys(raw.Conversation); got != "createdAt,id,projectId,title,updatedAt" {
		t.Fatalf("conversation keys=%s", got)
	}
	if got := keys(raw.Messages[0]); got != "body,conversationId,createdAt,id,projectId,role" {
		t.Fatalf("user message keys=%s", got)
	}
	if got := keys(raw.Assistant); got != "body,conversationId,createdAt,id,inputTokens,outputTokens,projectId,role" {
		t.Fatalf("assistant keys=%s", got)
	}
	if raw.Messages[0]["conversationId"] != raw.Conversation["id"] || strings.Contains(w.Body.String(), "userId") {
		t.Fatalf("body=%s", w.Body.String())
	}
	// 同じ形が、会話の取得・いちばん新しい会話・一覧にも出る。
	id := int64(raw.Conversation["id"].(float64))
	for _, target := range []string{projectConversationPath(1, id), projectChatPath(1)} {
		w = request(f.h, "GET", target, "")
		var got struct {
			Conversation map[string]any   `json:"conversation"`
			Messages     []map[string]any `json:"messages"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != 200 {
			t.Fatalf("%s: %d %s", target, w.Code, w.Body.String())
		}
		if keys(got.Conversation) != "createdAt,id,projectId,title,updatedAt" || len(got.Messages) != 2 || got.Messages[1]["conversationId"] != raw.Conversation["id"] {
			t.Fatalf("%s: %s", target, w.Body.String())
		}
	}
	w = request(f.h, "GET", projectConversationsPath(1), "")
	var list struct {
		Conversations []map[string]any `json:"conversations"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || len(list.Conversations) != 1 || keys(list.Conversations[0]) != "createdAt,id,projectId,title,updatedAt" {
		t.Fatalf("list (no messages inside): %s", w.Body.String())
	}
}

// 受け入れ条件 2: conversationId を付けると、その会話に続き、モデルにはその会話の履歴だけが渡る。
func TestProjectAIChatContinuesTheNamedConversationWithOnlyItsHistory(t *testing.T) {
	f := newConversationFixture(t)
	const admin = HandlerTestSessionID
	a := f.send(admin, 1, "A-1", withNewConversation)
	b := f.send(admin, 1, "B-1", withNewConversation)
	// B のほうが新しいが、A を指定すれば A に続く。
	got := f.send(admin, 1, "A-2", withConversation(a.Conversation.ID))
	if got.Conversation.ID != a.Conversation.ID || messageBodies(got.Messages) != "A-1|answer to A-1|A-2|answer to A-2" {
		t.Fatalf("conversation=%+v messages=%s", got.Conversation, messageBodies(got.Messages))
	}
	if turns := strings.Join(f.lastTurns(), "|"); turns != "A-1|answer to A-1|A-2" {
		t.Fatalf("only the named conversation's history reaches the model: %s", turns)
	}
	got = f.send(admin, 1, "B-2", withConversation(b.Conversation.ID))
	if turns := strings.Join(f.lastTurns(), "|"); turns != "B-1|answer to B-1|B-2" || messageBodies(got.Messages) != "B-1|answer to B-1|B-2|answer to B-2" {
		t.Fatalf("B: turns=%s messages=%s", turns, messageBodies(got.Messages))
	}
	// 保存されたものも、会話ごとに分かれている。
	stored, err := f.repo.ListProjectAIMessages(context.Background(), 1, f.admin.ID, a.Conversation.ID)
	if err != nil || messageBodies(stored) != "A-1|answer to A-1|A-2|answer to A-2" {
		t.Fatalf("stored A=%s err=%v", messageBodies(stored), err)
	}
	// 続きを保存した会話が、一覧の先頭に来る。
	if ids := f.listIDs(admin, 1); !slices.Equal(ids, []int64{b.Conversation.ID, a.Conversation.ID}) {
		t.Fatalf("list=%v", ids)
	}
	f.send(admin, 1, "A-3", withConversation(a.Conversation.ID))
	if ids := f.listIDs(admin, 1); !slices.Equal(ids, []int64{a.Conversation.ID, b.Conversation.ID}) {
		t.Fatalf("list after continuing A=%v", ids)
	}
}

// 受け入れ条件 7（メモリ）: モデルを待つ間に会話が消されても、回答は新しい会話として保存される。
func TestProjectAIChatStoresTheAnswerInANewConversationWhenItsConversationWasDeleted(t *testing.T) {
	for _, target := range []string{"named", "latest"} {
		t.Run(target, func(t *testing.T) {
			f := newConversationFixture(t)
			old := f.send(HandlerTestSessionID, 1, "OLD-QUESTION", withNewConversation).Conversation.ID
			f.chatter.fn = func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
				// 別のタブで、この会話が消される。
				if err := f.repo.DeleteProjectAIConversation(context.Background(), 1, f.admin.ID, old); err != nil {
					t.Error(err)
				}
				return "支払った回答", 5, 6, nil
			}
			fields := ""
			if target == "named" {
				fields = withConversation(old)
			}
			w := request(f.h, "POST", projectChatPath(1), `{"message":"続きの質問"`+fields+`}`)
			if w.Code != 200 {
				t.Fatalf("status=%d %s", w.Code, w.Body.String())
			}
			got := decodeProjectChat(t, w)
			if got.Conversation == nil || got.Conversation.ID == old || got.Conversation.Title != "続きの質問" {
				t.Fatalf("the answer must go to a new conversation: %+v", got.Conversation)
			}
			// 消された会話のメッセージは、新しい会話のものとして返さない。
			if messageBodies(got.Messages) != "続きの質問|支払った回答" || got.Messages[0].ConversationID != got.Conversation.ID || strings.Contains(w.Body.String(), "OLD-QUESTION") {
				t.Fatalf("messages=%s", w.Body.String())
			}
			if ids := f.listIDs(HandlerTestSessionID, 1); !slices.Equal(ids, []int64{got.Conversation.ID}) {
				t.Fatalf("list=%v", ids)
			}
			if stored := messageBodies(projectHistory(t, f.repo, 1, f.admin.ID)); stored != "続きの質問|支払った回答" {
				t.Fatalf("stored=%s", stored)
			}
			if usage, _ := f.repo.GetAIUsage(context.Background()); usage.RequestCount != 2 {
				t.Fatalf("usage=%+v", usage)
			}
		})
	}
}

// listAfterAppendFailRepo cannot read the messages back once an exchange was stored.
type listAfterAppendFailRepo struct {
	*memoryRepo
	appended bool
	// deleteBeforeAppend is a conversation that vanishes just before the exchange is stored.
	deleteBeforeAppend int64
}

func (r *listAfterAppendFailRepo) AppendProjectAITurn(ctx context.Context, projectID, userID int64, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error) {
	if r.deleteBeforeAppend != 0 {
		if err := r.memoryRepo.DeleteProjectAIConversation(ctx, projectID, userID, r.deleteBeforeAppend); err != nil {
			return ProjectAIConversation{}, err
		}
	}
	r.appended = true
	return r.memoryRepo.AppendProjectAITurn(ctx, projectID, userID, conversationID, turn)
}

func (r *listAfterAppendFailRepo) ListProjectAIMessages(ctx context.Context, projectID, userID, conversationID int64) ([]ProjectAIMessage, error) {
	if r.appended {
		return nil, errors.New("list failed SENTINEL-SQL")
	}
	return r.memoryRepo.ListProjectAIMessages(ctx, projectID, userID, conversationID)
}

// 保存の後の読み直しに失敗しても 200。代替の応答には、保存で返った会話を入れ、仮の 2 件にもその ID を付ける。
func TestProjectAIChatReplyWhenReadingBackFails(t *testing.T) {
	seed := func(t *testing.T) (*listAfterAppendFailRepo, http.Handler, ProjectAIConversation) {
		t.Helper()
		repo := &listAfterAppendFailRepo{memoryRepo: fresh()}
		c, err := repo.memoryRepo.AppendProjectAITurn(context.Background(), 1, 1, nil, ProjectAITurn{Title: "前の話題", UserBody: "old q", AssistantBody: "old a", InputTokens: 1, OutputTokens: 1})
		if err != nil {
			t.Fatal(err)
		}
		return repo, NewHandler(repo, WithAIChat(&fakeProjectChatter{fn: answers("new a", 3, 4)})), c
	}
	post := func(t *testing.T, h http.Handler, body string) projectChatReply {
		t.Helper()
		w := request(h, "POST", projectChatPath(1), body)
		if w.Code != 200 || strings.Contains(w.Body.String(), "SENTINEL") {
			t.Fatalf("status=%d %s", w.Code, w.Body.String())
		}
		return decodeProjectChat(t, w)
	}
	t.Run("same conversation keeps the history from before", func(t *testing.T) {
		_, h, c := seed(t)
		got := post(t, h, `{"message":"new q"`+withConversation(c.ID)+`}`)
		if got.Conversation == nil || got.Conversation.ID != c.ID || messageBodies(got.Messages) != "old q|old a|new q|new a" {
			t.Fatalf("conversation=%+v messages=%s", got.Conversation, messageBodies(got.Messages))
		}
		for _, m := range got.Messages {
			if m.ConversationID != c.ID {
				t.Fatalf("message=%+v", m)
			}
		}
		if got.Messages[2].ID != unstoredProjectChatUserID || got.Assistant.ID != unstoredProjectChatAssistantID || got.Assistant.Body != "new a" {
			t.Fatalf("placeholders=%+v %+v", got.Messages[2], got.Assistant)
		}
	})
	t.Run("a new conversation has only the two", func(t *testing.T) {
		_, h, c := seed(t)
		got := post(t, h, `{"message":"new q","newConversation":true}`)
		if got.Conversation == nil || got.Conversation.ID == c.ID || got.Conversation.Title != "new q" || messageBodies(got.Messages) != "new q|new a" {
			t.Fatalf("conversation=%+v messages=%s", got.Conversation, messageBodies(got.Messages))
		}
		if got.Messages[0].ConversationID != got.Conversation.ID || got.Assistant.ConversationID != got.Conversation.ID {
			t.Fatalf("placeholders must carry the stored conversation's id: %+v", got.Messages)
		}
	})
	t.Run("a deleted conversation's history is not returned as the new one's", func(t *testing.T) {
		repo, h, c := seed(t)
		repo.deleteBeforeAppend = c.ID
		got := post(t, h, `{"message":"new q"`+withConversation(c.ID)+`}`)
		if got.Conversation == nil || got.Conversation.ID == c.ID || messageBodies(got.Messages) != "new q|new a" {
			t.Fatalf("conversation=%+v messages=%s", got.Conversation, messageBodies(got.Messages))
		}
		if got.Messages[0].ConversationID != got.Conversation.ID || got.Assistant.ConversationID != got.Conversation.ID {
			t.Fatalf("placeholders=%+v", got.Messages)
		}
	})
}

// 保存に渡す会話は、モデルを呼ぶ前に決めたもの。待つ間に別の会話が新しくなっても、そちらには入らない。
func TestProjectAIChatStoresInTheConversationDecidedBeforeTheModel(t *testing.T) {
	f := newConversationFixture(t)
	first := f.send(HandlerTestSessionID, 1, "FIRST", withNewConversation).Conversation.ID
	var other ProjectAIConversation
	f.chatter.fn = func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		var err error
		// 別のタブ（別のインスタンス）で、新しい会話ができる。
		if other, err = f.repo.AppendProjectAITurn(context.Background(), 1, f.admin.ID, nil, ProjectAITurn{Title: "OTHER", UserBody: "other q", AssistantBody: "other a", InputTokens: 1, OutputTokens: 1}); err != nil {
			t.Error(err)
		}
		return "a", 1, 1, nil
	}
	w := request(f.h, "POST", projectChatPath(1), `{"message":"続き"}`)
	got := decodeProjectChat(t, w)
	if w.Code != 200 || got.Conversation == nil || got.Conversation.ID != first || messageBodies(got.Messages) != "FIRST|answer to FIRST|続き|a" {
		t.Fatalf("status=%d conversation=%+v messages=%s", w.Code, got.Conversation, messageBodies(got.Messages))
	}
	stored, _ := f.repo.ListProjectAIMessages(context.Background(), 1, f.admin.ID, other.ID)
	if messageBodies(stored) != "other q|other a" {
		t.Fatalf("the other conversation must not get the answer: %s", messageBodies(stored))
	}
}

// 受け入れ条件 6（ハンドラー経由）: 101 件目の会話を作ると、更新がいちばん古い会話が消える。
func TestProjectAIChatKeepsAHundredConversations(t *testing.T) {
	f := newConversationFixture(t)
	oldest := f.send(HandlerTestSessionID, 1, "oldest", withNewConversation).Conversation.ID
	second := f.send(HandlerTestSessionID, 1, "second", withNewConversation).Conversation.ID
	for i := 2; i < maxProjectAIConversations; i++ {
		f.send(HandlerTestSessionID, 1, fmt.Sprintf("c%03d", i), withNewConversation)
	}
	if got := f.listIDs(HandlerTestSessionID, 1); len(got) != 100 || got[99] != oldest {
		t.Fatalf("n=%d", len(got))
	}
	newest := f.send(HandlerTestSessionID, 1, "101st", withNewConversation).Conversation.ID
	got := f.listIDs(HandlerTestSessionID, 1)
	if len(got) != 100 || got[0] != newest || got[99] != second || slices.Contains(got, oldest) {
		t.Fatalf("n=%d first=%d last=%d", len(got), got[0], got[len(got)-1])
	}
	if w := request(f.h, "GET", projectConversationPath(1, oldest), ""); w.Code != 404 {
		t.Fatalf("the trimmed conversation: %d", w.Code)
	}
}

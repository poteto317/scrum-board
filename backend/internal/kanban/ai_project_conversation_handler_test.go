package kanban

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func projectConversationsPath(projectID int64) string {
	return "/api/projects/" + strconv.FormatInt(projectID, 10) + "/ai-conversations"
}

func projectConversationPath(projectID, conversationID int64) string {
	return projectConversationsPath(projectID) + "/" + strconv.FormatInt(conversationID, 10)
}

// listIDs reads the conversation list (the fixture is in ai_project_chat_conversation_test.go).
func (f *conversationFixture) listIDs(session string, projectID int64) []int64 {
	f.t.Helper()
	w := requestWithCookie(f.h, "GET", projectConversationsPath(projectID), "", session)
	if w.Code != 200 {
		f.t.Fatalf("GET conversations: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Conversations []ProjectAIConversation `json:"conversations"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Conversations == nil {
		f.t.Fatalf("body=%s err=%v", w.Body.String(), err)
	}
	ids := make([]int64, 0, len(out.Conversations))
	for _, c := range out.Conversations {
		ids = append(ids, c.ID)
	}
	return ids
}

// 受け入れ条件 3: 一覧は、呼び出したユーザーの、そのプロジェクトのものだけで、更新の新しい順。
func TestProjectAIConversationListIsTheCallersOwnNewestFirst(t *testing.T) {
	f := newConversationFixture(t)
	const admin, member = HandlerTestSessionID, "member-session"
	// 0 件は、空の配列（null ではない）。
	w := request(f.h, "GET", projectConversationsPath(1), "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"conversations":[]}` {
		t.Fatalf("empty list: %d %s", w.Code, w.Body.String())
	}
	a1 := f.send(admin, 1, "admin p1 first", withNewConversation).Conversation.ID
	m1 := f.send(member, 1, "member p1", withNewConversation).Conversation.ID
	a2 := f.send(admin, 1, "admin p1 second", withNewConversation).Conversation.ID
	o1 := f.send(admin, f.other.ID, "admin p2", withNewConversation).Conversation.ID
	if got := f.listIDs(admin, 1); !slices.Equal(got, []int64{a2, a1}) {
		t.Fatalf("admin p1=%v", got)
	}
	if got := f.listIDs(member, 1); !slices.Equal(got, []int64{m1}) {
		t.Fatalf("member p1=%v", got)
	}
	if got := f.listIDs(admin, f.other.ID); !slices.Equal(got, []int64{o1}) {
		t.Fatalf("admin p2=%v", got)
	}
	if got := f.listIDs(member, f.other.ID); len(got) != 0 {
		t.Fatalf("member p2=%v", got)
	}
	// 一覧の応答に、他人のタイトルは出ない。
	w = requestWithCookie(f.h, "GET", projectConversationsPath(1), "", member)
	if strings.Contains(w.Body.String(), "admin") {
		t.Fatalf("another user's conversation leaked: %s", w.Body.String())
	}
	// ANTHROPIC_API_KEY が無くても読める。
	if w = request(NewHandler(f.repo), "GET", projectConversationsPath(1), ""); w.Code != 200 {
		t.Fatalf("without a key: %d", w.Code)
	}
}

// 受け入れ条件 4: 別のユーザー・別のプロジェクトの会話 ID は、取得・削除・続きの送信のどれでも 404 で、存在しない ID と同じ応答。
func TestProjectAIConversationOfAnotherUserOrProjectIsTheSame404(t *testing.T) {
	f := newConversationFixture(t)
	const admin, member = HandlerTestSessionID, "member-session"
	mine := f.send(admin, 1, "admin p1", withNewConversation).Conversation.ID
	theirs := f.send(member, 1, "member p1 SECRET-TITLE", withNewConversation).Conversation.ID
	elsewhere := f.send(admin, f.other.ID, "admin p2", withNewConversation).Conversation.ID
	const missing = int64(987654)
	lim := &countingAIRateLimiter{allow: true}
	configured := NewHandler(f.repo, WithAIChat(f.chatter), WithAIRateLimiter(lim))
	notConfigured := NewHandler(f.repo)
	calls := f.chatter.callCount()
	const want = `{"message":"会話が見つかりません。"}`

	for label, id := range map[string]int64{"missing": missing, "another user's": theirs, "another project's": elsewhere} {
		for _, method := range []string{"GET", "DELETE"} {
			w := request(configured, method, projectConversationPath(1, id), "")
			if w.Code != 404 || strings.TrimSpace(w.Body.String()) != want {
				t.Fatalf("%s %s: %d %s", method, label, w.Code, w.Body.String())
			}
		}
		// 続きの送信も同じ 404。未設定の 503 より先で、モデルは呼ばず、回数制限の予約も使わない。
		for name, h := range map[string]http.Handler{"configured": configured, "not configured": notConfigured} {
			w := request(h, "POST", projectChatPath(1), `{"message":"q"`+withConversation(id)+`}`)
			if w.Code != 404 || strings.TrimSpace(w.Body.String()) != want {
				t.Fatalf("POST %s (%s): %d %s", label, name, w.Code, w.Body.String())
			}
		}
	}
	if tries, _ := lim.counts(); tries != 0 || f.chatter.callCount() != calls {
		t.Fatalf("a 404 must come before the limits and the model: tries=%d calls=%d", tries, f.chatter.callCount()-calls)
	}
	// 何も消えていないし、足されてもいない。
	if got := f.listIDs(member, 1); !slices.Equal(got, []int64{theirs}) {
		t.Fatalf("member's conversation must stay: %v", got)
	}
	if got := f.listIDs(admin, f.other.ID); !slices.Equal(got, []int64{elsewhere}) {
		t.Fatalf("the other project's conversation must stay: %v", got)
	}
	if got := messageBodies(projectHistory(t, f.repo, 1, f.member.ID)); got != "member p1 SECRET-TITLE|answer to member p1 SECRET-TITLE" {
		t.Fatalf("member's messages=%s", got)
	}
	// 自分のものは読める。会話が無いことの 404 は、プロジェクトが無いことの 404 と文言が違う。
	w := request(configured, "GET", projectConversationPath(1, mine), "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "admin p1") {
		t.Fatalf("own conversation: %d %s", w.Code, w.Body.String())
	}
	// 未設定のときも、自分の会話への送信は 503（404 の後）。
	w = request(notConfigured, "POST", projectChatPath(1), `{"message":"q"`+withConversation(mine)+`}`)
	if w.Code != 503 || decodeError(t, w).Code != "ai_not_configured" {
		t.Fatalf("own conversation without a key: %d %s", w.Code, w.Body.String())
	}
}

// 会話の経路の、ログイン・プロジェクト・会話 ID の検査。
func TestProjectAIConversationRoutesCheckLoginProjectAndID(t *testing.T) {
	f := newConversationFixture(t)
	id := f.send(HandlerTestSessionID, 1, "q", withNewConversation).Conversation.ID
	routes := []struct{ method, suffix string }{{"GET", ""}, {"GET", "/" + strconv.FormatInt(id, 10)}, {"DELETE", "/" + strconv.FormatInt(id, 10)}}
	for _, route := range routes {
		target := projectConversationsPath(1) + route.suffix
		if w := requestAnon(f.h, route.method, target, ""); w.Code != 401 || decodeError(t, w).Message != msgLoginRequired {
			t.Fatalf("%s %s anonymous: %d %s", route.method, target, w.Code, w.Body.String())
		}
		for _, bad := range []string{"abc", "0", "-1"} {
			w := request(f.h, route.method, "/api/projects/"+bad+"/ai-conversations"+route.suffix, "")
			if e := decodeError(t, w); w.Code != 400 || e.Message != "プロジェクトIDが不正です。" {
				t.Fatalf("%s project %s: %d %s", route.method, bad, w.Code, w.Body.String())
			}
		}
		w := request(f.h, route.method, projectConversationsPath(999)+route.suffix, "")
		if e := decodeError(t, w); w.Code != 404 || e.Message != "プロジェクトが見つかりません。" {
			t.Fatalf("%s missing project: %d %s", route.method, w.Code, w.Body.String())
		}
	}
	for _, method := range []string{"GET", "DELETE"} {
		for _, bad := range []string{"abc", "0", "-1", "1.5"} {
			w := request(f.h, method, projectConversationsPath(1)+"/"+bad, "")
			if e := decodeError(t, w); w.Code != 400 || e.Message != "会話IDが不正です。" || e.Code != "" {
				t.Fatalf("%s conversation %s: %d %s", method, bad, w.Code, w.Body.String())
			}
		}
	}
	if got := f.listIDs(HandlerTestSessionID, 1); !slices.Equal(got, []int64{id}) {
		t.Fatalf("nothing may be deleted by a rejected request: %v", got)
	}
}

// 受け入れ条件 5: 会話の削除で、その会話のメッセージも消える。ほかの会話は残る。DELETE …/ai-chat は自分のそのプロジェクトの会話を全部消す。
func TestProjectAIConversationDeleteAndClear(t *testing.T) {
	f := newConversationFixture(t)
	const admin, member = HandlerTestSessionID, "member-session"
	a := f.send(admin, 1, "A", withNewConversation).Conversation.ID
	b := f.send(admin, 1, "B", withNewConversation).Conversation.ID
	c := f.send(admin, 1, "C", withNewConversation).Conversation.ID
	m := f.send(member, 1, "M", withNewConversation).Conversation.ID
	o := f.send(admin, f.other.ID, "O", withNewConversation).Conversation.ID

	w := request(f.h, "DELETE", projectConversationPath(1, b), "")
	if w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("DELETE: %d %s", w.Code, w.Body.String())
	}
	if got := f.listIDs(admin, 1); !slices.Equal(got, []int64{c, a}) {
		t.Fatalf("after delete: %v", got)
	}
	if got := messageBodies(projectHistory(t, f.repo, 1, f.admin.ID)); got != "A|answer to A|C|answer to C" {
		t.Fatalf("the deleted conversation's messages must be gone, the others stay: %s", got)
	}
	// もう無い会話は 404（取得・削除・送信）。
	for _, method := range []string{"GET", "DELETE"} {
		if w = request(f.h, method, projectConversationPath(1, b), ""); w.Code != 404 || decodeError(t, w).Message != "会話が見つかりません。" {
			t.Fatalf("%s deleted: %d %s", method, w.Code, w.Body.String())
		}
	}
	if w = request(f.h, "POST", projectChatPath(1), `{"message":"q"`+withConversation(b)+`}`); w.Code != 404 {
		t.Fatalf("POST to a deleted conversation: %d %s", w.Code, w.Body.String())
	}

	// DELETE …/ai-chat は、自分のそのプロジェクトの会話を全部。
	if w = request(f.h, "DELETE", projectChatPath(1), ""); w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("clear: %d %s", w.Code, w.Body.String())
	}
	if got := f.listIDs(admin, 1); len(got) != 0 || len(projectHistory(t, f.repo, 1, f.admin.ID)) != 0 {
		t.Fatalf("cleared: %v", got)
	}
	if got := f.listIDs(member, 1); !slices.Equal(got, []int64{m}) {
		t.Fatalf("another user's conversations must stay: %v", got)
	}
	if got := f.listIDs(admin, f.other.ID); !slices.Equal(got, []int64{o}) {
		t.Fatalf("another project's conversations must stay: %v", got)
	}
	if len(projectHistory(t, f.repo, 1, f.member.ID)) != 2 || len(projectHistory(t, f.repo, f.other.ID, f.admin.ID)) != 2 {
		t.Fatal("their messages must stay")
	}
}

// GET …/ai-conversations/{cid} は、その会話とメッセージ（古い順）。
func TestProjectAIConversationGET(t *testing.T) {
	f := newConversationFixture(t)
	a := f.send(HandlerTestSessionID, 1, "A-1", withNewConversation).Conversation.ID
	f.send(HandlerTestSessionID, 1, "B-1", withNewConversation)
	f.send(HandlerTestSessionID, 1, "A-2", withConversation(a))
	w := request(f.h, "GET", projectConversationPath(1, a), "")
	got := decodeProjectChat(t, w)
	if w.Code != 200 || got.Conversation == nil || got.Conversation.ID != a || got.Conversation.Title != "A-1" || messageBodies(got.Messages) != "A-1|answer to A-1|A-2|answer to A-2" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestProjectChatReplaceTargetOK(t *testing.T) {
	history := []ProjectAIMessage{
		{ID: 1, Role: AIRoleUser, Body: "q1"},
		{ID: 2, Role: AIRoleAssistant, Body: "a1"},
		{ID: 3, Role: AIRoleUser, Body: "q2"},
		{ID: 4, Role: AIRoleAssistant, Body: "a2"},
	}
	if !projectChatReplaceTargetOK(history, 3) {
		t.Fatal("last user must be ok")
	}
	if projectChatReplaceTargetOK(history, 1) {
		t.Fatal("earlier user must be refused")
	}
	if projectChatReplaceTargetOK(history, 4) {
		t.Fatal("assistant must be refused")
	}
	if projectChatReplaceTargetOK(history, 99) {
		t.Fatal("missing must be refused")
	}
	if got := projectChatHistoryBeforeReplace(history, 3); len(got) != 2 || got[0].ID != 1 || got[1].ID != 2 {
		t.Fatalf("filter=%+v", got)
	}
}

func decodeProjectChatBody(t *testing.T, body string) (int, string) {
	t.Helper()
	h := handler{messageMax: 4000}
	w := request(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		req, ok := h.decodeProjectChatRequest(rw, r)
		if !ok {
			return
		}
		reply(rw, http.StatusOK, req)
	}), "POST", projectChatPath(1), body)
	if w.Code != 200 {
		return w.Code, decodeError(t, w).Message
	}
	return 200, ""
}

func TestDecodeProjectChatReplaceRequest(t *testing.T) {
	if code, msg := decodeProjectChatBody(t, `{"message":"q","replaceFromMessageId":0}`); code != 400 || msg != msgProjectChatReplaceInvalidID {
		t.Fatalf("zero: %d %s", code, msg)
	}
	if code, msg := decodeProjectChatBody(t, `{"message":"q","replaceFromMessageId":1,"newConversation":true}`); code != 400 || msg != msgProjectChatReplaceAndNew {
		t.Fatalf("with new: %d %s", code, msg)
	}
	if code, msg := decodeProjectChatBody(t, `{"message":"q","replaceFromMessageId":1}`); code != 400 || msg != msgProjectChatReplaceNeedsConversation {
		t.Fatalf("no conversation: %d %s", code, msg)
	}
	if code, _ := decodeProjectChatBody(t, `{"message":"q","conversationId":1,"replaceFromMessageId":2}`); code != 200 {
		t.Fatalf("ok body: %d", code)
	}
}

func TestProjectAIChatReplaceValidation(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	c, err = repo.AppendProjectAITurn(ctx, 1, 1, &c.ID, ProjectAITurn{UserBody: "q2", AssistantBody: "a2", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	chatter := &fakeProjectChatter{fn: answers("should not run", 1, 1)}
	h := NewHandler(repo, WithAIChat(chatter))

	// 直前でない user
	body := fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":%d}`, c.ID, msgs[0].ID)
	if w := postProjectChat(h, 1, body); w.Code != 400 || decodeError(t, w).Message != msgProjectChatReplaceInvalid {
		t.Fatalf("not last user: %d %s", w.Code, w.Body.String())
	}
	// assistant
	body = fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":%d}`, c.ID, msgs[3].ID)
	if w := postProjectChat(h, 1, body); w.Code != 400 || decodeError(t, w).Message != msgProjectChatReplaceInvalid {
		t.Fatalf("assistant: %d %s", w.Code, w.Body.String())
	}
	// missing
	body = fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":99999}`, c.ID)
	if w := postProjectChat(h, 1, body); w.Code != 400 || decodeError(t, w).Message != msgProjectChatReplaceInvalid {
		t.Fatalf("missing: %d %s", w.Code, w.Body.String())
	}
	if chatter.callCount() != 0 {
		t.Fatal("model must not run on replace validation failure")
	}
	if got := projectHistory(t, repo, 1, 1); len(got) != 4 {
		t.Fatalf("history changed: %+v", got)
	}
}

// 不正 replace は AI 未設定でも admit（503）より前に 400。
func TestProjectAIChatReplaceInvalidBeforeUnconfigured(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{Title: "t", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil || len(msgs) < 1 {
		t.Fatalf("msgs=%+v err=%v", msgs, err)
	}
	h := NewHandler(repo) // no WithAIChat → admit would be 503
	body := fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":99999}`, c.ID)
	if w := postProjectChat(h, 1, body); w.Code != 400 || decodeError(t, w).Message != msgProjectChatReplaceInvalid {
		t.Fatalf("unconfigured + bad replace: %d %s", w.Code, w.Body.String())
	}
}

func TestProjectAIChatReplaceSuccessFiltersHistoryAndTruncates(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	c, err = repo.AppendProjectAITurn(ctx, 1, 1, &c.ID, ProjectAITurn{UserBody: "q2", AssistantBody: "a2", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	chatter := &fakeProjectChatter{fn: answers("new answer", 3, 4)}
	h := NewHandler(repo, WithAIChat(chatter))
	body := fmt.Sprintf(`{"message":"edited q2","conversationId":%d,"replaceFromMessageId":%d}`, c.ID, msgs[2].ID)
	w := postProjectChat(h, 1, body)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	out := decodeProjectChat(t, w)
	if len(out.Messages) != 4 || out.Messages[0].Body != "q1" || out.Messages[2].Body != "edited q2" || out.Messages[3].Body != "new answer" {
		t.Fatalf("messages=%+v", out.Messages)
	}
	chatter.mu.Lock()
	turns := chatter.turns[len(chatter.turns)-1]
	chatter.mu.Unlock()
	// モデルには id < replaceFrom だけ（q1/a1）＋新しいメッセージ。
	if len(turns) != 3 || turns[0].Body != "q1" || turns[1].Body != "a1" || turns[2].Body != "edited q2" {
		t.Fatalf("model turns=%+v", turns)
	}
}

// モデル失敗時は Replace/DELETE を呼ばず、履歴は不変（L-001）。
func TestProjectAIChatReplaceModelFailureDoesNotTruncate(t *testing.T) {
	repo := &replaceCallRepo{memoryRepo: fresh()}
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	chatter := &fakeProjectChatter{fn: func(context.Context, string, []ChatTurn, ToolRunner) (string, int64, int64, error) {
		return "", 0, 0, errors.New("model down")
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	body := fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":%d}`, c.ID, msgs[0].ID)
	w := postProjectChat(h, 1, body)
	if w.Code != 502 || decodeError(t, w).Code != "ai_failed" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if repo.replaceCalls != 0 {
		t.Fatalf("ReplaceAndAppend must not run on model failure: calls=%d", repo.replaceCalls)
	}
	after, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil || len(after) != 2 || after[0].Body != "q1" || after[1].Body != "a1" {
		t.Fatalf("history must stay: %+v err=%v", after, err)
	}
}

type replaceCallRepo struct {
	*memoryRepo
	replaceCalls int
	replaceErr   error
}

func (r *replaceCallRepo) ReplaceAndAppendProjectAITurn(ctx context.Context, projectID, userID, conversationID, replaceFromMessageID int64, turn ProjectAITurn) (ProjectAIConversation, error) {
	r.replaceCalls++
	if r.replaceErr != nil {
		return ProjectAIConversation{}, r.replaceErr
	}
	return r.memoryRepo.ReplaceAndAppendProjectAITurn(ctx, projectID, userID, conversationID, replaceFromMessageID, turn)
}

// モデル成功後に Replace が stale なら 400 で、履歴は不変（storage 500 に潰さない）。
func TestProjectAIChatReplaceStaleAfterModelIsBadRequest(t *testing.T) {
	repo := &replaceCallRepo{memoryRepo: fresh(), replaceErr: ErrProjectAIReplaceStale}
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	chatter := &fakeProjectChatter{fn: answers("paid answer", 1, 1)}
	h := NewHandler(repo, WithAIChat(chatter))
	body := fmt.Sprintf(`{"message":"edited","conversationId":%d,"replaceFromMessageId":%d}`, c.ID, msgs[0].ID)
	w := postProjectChat(h, 1, body)
	if w.Code != 400 || decodeError(t, w).Message != msgProjectChatReplaceInvalid {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if repo.replaceCalls != 1 {
		t.Fatalf("ReplaceAndAppend calls=%d", repo.replaceCalls)
	}
	after, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil || len(after) != 2 || after[0].Body != "q1" {
		t.Fatalf("history must stay: %+v err=%v", after, err)
	}
}

func TestLoadProjectChatInputFiltersReplaceFrom(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	mine, err := repo.AppendProjectAITurn(ctx, 1, 7, nil, ProjectAITurn{Title: "t", UserBody: "old q", AssistantBody: "old a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	mine, err = repo.AppendProjectAITurn(ctx, 1, 7, &mine.ID, ProjectAITurn{UserBody: "last q", AssistantBody: "last a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListProjectAIMessages(ctx, 1, 7, mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	h := handler{repo: repo, historyTurns: 20}
	replaceFrom := msgs[2].ID
	preloaded := projectChatHistoryBeforeReplace(msgs, replaceFrom)
	in, err := h.loadProjectChatInput(ctx, Project{ID: 1, Name: "Alpha"}, &User{ID: 7}, &mine, projectAIChatRequest{
		Message: "edited", ReplaceFromMessageID: &replaceFrom,
	}, preloaded, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.history) != 2 || in.history[0].Body != "old q" || len(in.turns) != 3 || in.turns[2].Body != "edited" {
		t.Fatalf("history=%+v turns=%+v", in.history, in.turns)
	}
	if strings.Contains(fmt.Sprintf("%v", in.turns), "last q") {
		t.Fatalf("replaced turn must not reach the model: %+v", in.turns)
	}
}

func TestProjectAIChatReplaceJSONRoundTripField(t *testing.T) {
	raw := `{"message":"q","conversationId":1,"replaceFromMessageId":2}`
	var req projectAIChatRequest
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.ReplaceFromMessageID == nil || *req.ReplaceFromMessageID != 2 {
		t.Fatalf("decode=%+v err=%v", req, err)
	}
}
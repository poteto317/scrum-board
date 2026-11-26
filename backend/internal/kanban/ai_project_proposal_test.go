package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestProposalTransitionAllowed(t *testing.T) {
	n := int64(9)
	pending := ProjectAIProposal{Kind: ProposalKindItemCreate, State: ProposalStatePending}
	applied := ProjectAIProposal{Kind: ProposalKindItemCreate, State: ProposalStateApplied}
	appliedWithNumber := ProjectAIProposal{Kind: ProposalKindItemCreate, State: ProposalStateApplied, CreatedItemNumber: &n}
	appliedStatus := ProjectAIProposal{Kind: ProposalKindStatusChange, State: ProposalStateApplied}
	dismissed := ProjectAIProposal{Kind: ProposalKindItemCreate, State: ProposalStateDismissed}
	cases := []struct {
		name    string
		current ProjectAIProposal
		change  ProjectAIProposalChange
		want    bool
	}{
		{"claim", pending, ProjectAIProposalChange{State: ProposalStateApplied}, true},
		{"dismiss", pending, ProjectAIProposalChange{State: ProposalStateDismissed}, true},
		{"release", applied, ProjectAIProposalChange{State: ProposalStatePending}, true},
		{"record", applied, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}, true},
		{"pending again", pending, ProjectAIProposalChange{State: ProposalStatePending}, false},
		{"claim with number", pending, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}, false},
		{"claim twice", applied, ProjectAIProposalChange{State: ProposalStateApplied}, false},
		{"dismiss applied", applied, ProjectAIProposalChange{State: ProposalStateDismissed}, false},
		{"release recorded", appliedWithNumber, ProjectAIProposalChange{State: ProposalStatePending}, false},
		{"record twice", appliedWithNumber, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}, false},
		{"record status change", appliedStatus, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}, false},
		{"from dismissed", dismissed, ProjectAIProposalChange{State: ProposalStateApplied}, false},
		{"undismiss", dismissed, ProjectAIProposalChange{State: ProposalStatePending}, false},
	}
	for _, c := range cases {
		if got := proposalTransitionAllowed(c.current, c.change); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

// proposalTurn stores one exchange with the given proposals and returns the conversation id.
func proposalTurn(t *testing.T, repo Repository, projectID, userID int64, drafts ...ProjectAIProposalDraft) int64 {
	t.Helper()
	c, err := repo.AppendProjectAITurn(context.Background(), projectID, userID, nil, ProjectAITurn{Title: "q", UserBody: "q", AssistantBody: "a", Proposals: drafts})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func createDraft(title string) ProjectAIProposalDraft {
	return ProjectAIProposalDraft{Kind: ProposalKindItemCreate, ColumnID: ptrTo(int64(1)), ColumnName: ptrTo("Todo"), Title: ptrTo(title), Description: ptrTo("")}
}

func assistantProposals(t *testing.T, repo Repository, projectID, userID, conversationID int64) []ProjectAIProposal {
	t.Helper()
	list, err := repo.ListProjectAIMessages(context.Background(), projectID, userID, conversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Proposals != nil {
		t.Fatalf("messages=%+v", list)
	}
	return list[1].Proposals
}

// 受け入れ条件（保存と再読み込み・二重適用・権限）: memory の実装。
func TestMemoryProjectAIProposalsStoredUpdatedAndDropped(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	cid := proposalTurn(t, repo, 1, 1, createDraft("一"), ProjectAIProposalDraft{Kind: ProposalKindDescriptionEdit,
		ItemNumber: ptrTo(int64(3)), ItemTitle: ptrTo("t"), Description: ptrTo("新"), BaseDescription: ptrTo("")})
	got := assistantProposals(t, repo, 1, 1, cid)
	if len(got) != 2 || got[0].State != ProposalStatePending || *got[0].Title != "一" || got[1].BaseDescription == nil || *got[1].BaseDescription != "" {
		t.Fatalf("proposals=%+v", got)
	}
	id := got[0].ID
	if _, err := repo.UpdateProjectAIProposal(ctx, 1, 1, id, ProjectAIProposalChange{State: ProposalStateApplied}); err != nil {
		t.Fatal(err)
	}
	cur, err := repo.UpdateProjectAIProposal(ctx, 1, 1, id, ProjectAIProposalChange{State: ProposalStateApplied})
	if !errors.Is(err, ErrProposalConflict) || cur.State != ProposalStateApplied {
		t.Fatalf("second claim: %+v %v", cur, err)
	}
	if _, err := repo.UpdateProjectAIProposal(ctx, 1, 2, id, ProjectAIProposalChange{State: ProposalStateDismissed}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user: %v", err)
	}
	n := int64(42)
	if p, err := repo.UpdateProjectAIProposal(ctx, 1, 1, id, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}); err != nil || *p.CreatedItemNumber != 42 {
		t.Fatalf("record: %+v %v", p, err)
	}
	if got := assistantProposals(t, repo, 1, 1, cid); got[0].State != ProposalStateApplied || *got[0].CreatedItemNumber != 42 {
		t.Fatalf("reloaded=%+v", got[0])
	}
	// 会話の削除・全消去で、提案も消える（ON DELETE CASCADE の真似）。
	if err := repo.DeleteProjectAIConversation(ctx, 1, 1, cid); err != nil {
		t.Fatal(err)
	}
	proposalTurn(t, repo, 1, 1, createDraft("二"))
	if err := repo.ClearProjectAIConversations(ctx, 1, 1); err != nil {
		t.Fatal(err)
	}
	if len(repo.projectAIProposals) != 0 {
		t.Fatalf("left=%+v", repo.projectAIProposals)
	}
	// メッセージの上限で古いメッセージが消えると、その提案も消える。
	cid = proposalTurn(t, repo, 1, 1, createDraft("三"))
	for range maxAIChatStoredMessages / projectAITurnMessages {
		if _, err := repo.AppendProjectAITurn(ctx, 1, 1, &cid, ProjectAITurn{UserBody: "q", AssistantBody: "a"}); err != nil {
			t.Fatal(err)
		}
	}
	if len(repo.projectAIProposals) != 0 {
		t.Fatalf("trimmed message kept its proposals: %+v", repo.projectAIProposals)
	}
}

func decodeProposed(t *testing.T, out string) {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal([]byte(out), &v); err != nil || v["proposed"] != true {
		t.Fatalf("not proposed: %s", out)
	}
}

// 受け入れ条件（権限・Todo の固定・上限）: 提案のツール。
func TestProposalToolsCheckTheItemAndCollect(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	card := f.item(t, ItemInput{Title: "対象", Description: "今の説明"})
	empty := f.item(t, ItemInput{Title: "空"})
	hidden := f.item(t, ItemInput{Title: "隠す"})
	if _, err := f.repo.ReplaceItemACL(ctx, hidden.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	readOnly := f.item(t, ItemInput{Title: "読むだけ"})
	if _, err := f.repo.ReplaceItemACL(ctx, readOnly.ID, ViewAccessOpen, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	archived := f.item(t, ItemInput{Title: "アーカイブ"})
	at := time.Now().UTC()
	c := f.repo.cards[archived.ID]
	c.ArchivedAt = &at
	f.repo.cards[archived.ID] = c
	elsewhere := f.item(t, ItemInput{Title: "別", ProjectID: &f.other.ID})

	e := f.exec(f.member, 1)
	num := func(n int64) string { return fmt.Sprintf(`{"number":%d,"status":"Doing"}`, n) }
	for _, tc := range []struct{ input, want string }{
		{num(hidden.Number), toolErrItemNotFound},
		{num(elsewhere.Number + 1000), toolErrItemNotFound},
		{num(readOnly.Number), toolErrNotEditable},
		{num(archived.Number), toolErrArchived},
		{fmt.Sprintf(`{"number":%d,"status":"無い列"}`, card.Number), toolErrUnknownStatus},
		{fmt.Sprintf(`{"number":%d,"status":"Todo"}`, card.Number), toolErrSameStatus},
		{fmt.Sprintf(`{"number":%d,"status":"Doing","columnId":3}`, card.Number), toolErrInvalidInput},
	} {
		if got := runTool(t, e, toolProposeStatusChange, tc.input); !strings.Contains(got, tc.want) {
			t.Errorf("%s: got %s want %s", tc.input, got, tc.want)
		}
	}
	// 説明の編集は、今回の質問で get_item で全文を読んだアイテムにだけ。
	if got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":"新"}`, card.Number)); !strings.Contains(got, toolErrDescriptionNotRead) {
		t.Errorf("unread description: %s", got)
	}
	runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d}`, card.Number))
	runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d}`, empty.Number))
	if got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":"今の説明"}`, card.Number)); !strings.Contains(got, toolErrSameDescription) {
		t.Errorf("same description: %s", got)
	}
	if got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":""}`, empty.Number)); !strings.Contains(got, toolErrSameDescription) {
		t.Errorf("same empty description: %s", got)
	}
	// 列は渡せない（Todo に固定）。タイトルの上限。
	for _, input := range []string{`{"title":"x","columnId":2}`, `{"title":"x","status":"Done"}`, `{"description":"no title"}`} {
		if got := runTool(t, e, toolProposeItemCreate, input); !strings.Contains(got, toolErrInvalidInput) {
			t.Errorf("%s: %s", input, got)
		}
	}
	if got := runTool(t, e, toolProposeItemCreate, fmt.Sprintf(`{"title":%q}`, strings.Repeat("あ", 201))); !strings.Contains(got, toolErrProposalText) {
		t.Errorf("long title: %s", got)
	}
	if len(e.Proposals()) != 0 {
		t.Fatalf("rejected ones must not be collected: %+v", e.Proposals())
	}

	decodeProposed(t, runTool(t, e, toolProposeStatusChange, fmt.Sprintf(`{"number":%d,"status":" Doing "}`, card.Number)))
	decodeProposed(t, runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":"新しい説明"}`, empty.Number)))
	decodeProposed(t, runTool(t, e, toolProposeItemCreate, `{"title":"  新しいアイテム ","description":"本文"}`))
	got := e.Proposals()
	if len(got) != 3 {
		t.Fatalf("proposals=%+v", got)
	}
	if s := got[0]; s.Kind != ProposalKindStatusChange || *s.ItemNumber != card.Number || *s.ColumnID != 2 || *s.ColumnName != "Doing" {
		t.Fatalf("status=%+v", s)
	}
	if d := got[1]; d.Kind != ProposalKindDescriptionEdit || d.BaseDescription == nil || *d.BaseDescription != "" || *d.Description != "新しい説明" {
		t.Fatalf("description=%+v", d)
	}
	if c := got[2]; c.Kind != ProposalKindItemCreate || *c.ColumnID != 1 || *c.ColumnName != "Todo" || *c.Title != "新しいアイテム" || c.ItemNumber != nil {
		t.Fatalf("create=%+v", c)
	}
	decodeProposed(t, runTool(t, e, toolProposeItemCreate, `{"title":"4"}`))
	decodeProposed(t, runTool(t, e, toolProposeItemCreate, `{"title":"5"}`))
	if out := runTool(t, e, toolProposeItemCreate, `{"title":"6"}`); !strings.Contains(out, toolErrProposalLimit) || len(e.Proposals()) != maxProposalsPerQuestion {
		t.Fatalf("limit: %s %d", out, len(e.Proposals()))
	}
}

func TestProposalCreateNeedsATodoColumn(t *testing.T) {
	if _, problem := itemCreateDraft([]Column{{ID: 2, Name: "Doing"}}, "t", ""); problem != toolErrNoTodoColumn {
		t.Fatalf("problem=%q", problem)
	}
}

// 受け入れ条件（保存と再読み込み）: 回答と一緒に保存され、GET の 2 つの経路でも戻る。
func TestProjectAIChatStoresProposalsWithTheAnswer(t *testing.T) {
	f := newToolFixture(t)
	card := f.item(t, ItemInput{Title: "対象"})
	chatter := &fakeProjectChatter{fn: func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
		for i := range 6 {
			if _, err := run(ctx, ToolCall{ID: "c", Name: toolProposeItemCreate, Input: json.RawMessage(fmt.Sprintf(`{"title":"作る%d"}`, i))}); err != nil {
				return "", 0, 0, err
			}
		}
		if _, err := run(ctx, ToolCall{ID: "s", Name: toolProposeStatusChange, Input: json.RawMessage(fmt.Sprintf(`{"number":%d,"status":"Done"}`, card.Number))}); err != nil {
			return "", 0, 0, err
		}
		return "提案しました。", 1, 1, nil
	}}
	h := NewHandler(f.repo, WithAIChat(chatter))
	w := postProjectChat(h, 1, `{"message":"作って"}`)
	if w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	out := decodeProjectChat(t, w)
	if len(out.Assistant.Proposals) != maxProposalsPerQuestion || out.Assistant.Proposals[0].ID == 0 || out.Messages[1].Proposals == nil {
		t.Fatalf("assistant=%+v", out.Assistant)
	}
	if len(chatter.tools) != 5 {
		t.Fatalf("tools=%d", len(chatter.tools))
	}
	for _, path := range []string{projectChatPath(1), fmt.Sprintf("/api/projects/1/ai-conversations/%d", out.Conversation.ID)} {
		got := decodeProjectChat(t, request(h, "GET", path, ""))
		if len(got.Messages) != 2 || len(got.Messages[1].Proposals) != maxProposalsPerQuestion {
			t.Fatalf("%s: %+v", path, got.Messages)
		}
	}
	// チャットが失敗したら、提案も保存しない。
	chatter.fn = func(ctx context.Context, _ string, _ []ChatTurn, run ToolRunner) (string, int64, int64, error) {
		_, _ = run(ctx, ToolCall{ID: "c", Name: toolProposeItemCreate, Input: json.RawMessage(`{"title":"x"}`)})
		return "", 1, 1, errors.New("model failed")
	}
	before := len(f.repo.projectAIProposals)
	if w := postProjectChat(h, 1, `{"message":"また"}`); w.Code == 200 {
		t.Fatalf("want failure, got 200")
	}
	if len(f.repo.projectAIProposals) != before {
		t.Fatalf("stored after failure")
	}
}

// 読み直しに失敗して組み立てた回答には、提案を付けない（ID が分からず適用できない）。
func TestUnstoredProjectChatTurnCarriesNoProposals(t *testing.T) {
	before := []ProjectAIMessage{{ID: 1, Role: AIRoleUser}, {ID: 2, Role: AIRoleAssistant, Proposals: []ProjectAIProposal{{ID: 5}}}}
	list := unstoredProjectChatTurn(1, 3, before, ProjectAITurn{UserBody: "q", AssistantBody: "a", Proposals: []ProjectAIProposalDraft{createDraft("x")}})
	for _, m := range list {
		if m.Proposals != nil {
			t.Fatalf("message %d has proposals", m.ID)
		}
	}
	if before[1].Proposals == nil {
		t.Fatal("the caller's history must not be changed")
	}
}

// L-635: 提案の中身（利用者の文字列を含む）をプロンプトに戻さない。
func TestProjectChatPromptLeavesProposalsOut(t *testing.T) {
	history := []ProjectAIMessage{{Role: AIRoleUser, Body: "q"}, {Role: AIRoleAssistant, Body: "a", Proposals: []ProjectAIProposal{{
		Kind: ProposalKindItemCreate, Title: ptrTo("PROPOSAL-TITLE"), Description: ptrTo("PROPOSAL-BODY")}}}}
	in := newProjectChatInput("p", time.Now(), []Column{{ID: 1, Name: "Todo"}}, nil, history, "次", 10)
	all := in.system
	for _, turn := range in.turns {
		all += turn.Body
	}
	if strings.Contains(all, "PROPOSAL-") {
		t.Fatalf("proposal leaked into the prompt")
	}
}

// 切り詰めて渡した説明（4000 文字を超える）や、読んだ後に変わった説明には、全文の置き換えを提案できない。
func TestDescriptionEditNeedsTheWholeDescriptionRead(t *testing.T) {
	f := newToolFixture(t)
	long := f.item(t, ItemInput{Title: "長い", Description: strings.Repeat("あ", maxAIChatContextFieldLen+1000)})
	changed := f.item(t, ItemInput{Title: "変わる", Description: "読んだとき"})
	e := f.exec(f.admin, 1)
	runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d}`, long.Number))
	if got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":"短く"}`, long.Number)); !strings.Contains(got, toolErrDescriptionNotRead) {
		t.Fatalf("clipped description: %s", got)
	}
	runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d}`, changed.Number))
	c := f.repo.cards[changed.ID]
	c.Description = "別の人が変えた"
	f.repo.cards[changed.ID] = c
	if got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(`{"number":%d,"description":"新"}`, changed.Number)); !strings.Contains(got, toolErrDescriptionNotRead) {
		t.Fatalf("changed after reading: %s", got)
	}
	if len(e.Proposals()) != 0 {
		t.Fatalf("proposals=%+v", e.Proposals())
	}
}

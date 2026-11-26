package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func proposalPath(projectID, proposalID int64) string {
	return fmt.Sprintf("/api/projects/%d/ai-proposals/%d", projectID, proposalID)
}

// 受け入れ条件（二重適用・権限）: 状態の API。
func TestUpdateProjectAIProposalAPI(t *testing.T) {
	f := newToolFixture(t)
	h := NewHandler(f.repo)
	cid := proposalTurn(t, f.repo, 1, f.admin.ID, createDraft("作る"), ProjectAIProposalDraft{Kind: ProposalKindStatusChange,
		ItemNumber: ptrTo(int64(1)), ColumnID: ptrTo(int64(2)), ColumnName: ptrTo("Doing")})
	list := assistantProposals(t, f.repo, 1, f.admin.ID, cid)
	create, status := list[0], list[1]

	for _, body := range []string{`{"state":"done"}`, `{"state":"applied","createdItemNumber":0}`, `{"state":"dismissed","createdItemNumber":3}`, `{}`} {
		if w := request(h, "PATCH", proposalPath(1, create.ID), body); w.Code != 400 {
			t.Errorf("%s: status=%d", body, w.Code)
		}
	}
	if w := request(h, "PATCH", "/api/projects/1/ai-proposals/0", `{"state":"applied"}`); w.Code != 400 {
		t.Errorf("id 0: %d", w.Code)
	}
	// 他人・別プロジェクト・無い提案は 404（あるかどうかを漏らさない）。
	if w := requestWithCookie(h, "PATCH", proposalPath(1, create.ID), `{"state":"applied"}`, "member-session"); w.Code != 404 {
		t.Errorf("member: %d", w.Code)
	}
	if w := request(h, "PATCH", proposalPath(f.other.ID, create.ID), `{"state":"applied"}`); w.Code != 404 {
		t.Errorf("other project: %d", w.Code)
	}
	if w := request(h, "PATCH", proposalPath(999, create.ID), `{"state":"applied"}`); w.Code != 404 {
		t.Errorf("missing project: %d", w.Code)
	}

	// 確保は 1 回だけ。2 回目は 409 と現在の提案。
	if w := request(h, "PATCH", proposalPath(1, create.ID), `{"state":"applied"}`); w.Code != 200 {
		t.Fatalf("claim: %d %s", w.Code, w.Body.String())
	}
	w := request(h, "PATCH", proposalPath(1, create.ID), `{"state":"applied"}`)
	var conflict struct {
		Message  string            `json:"message"`
		Proposal ProjectAIProposal `json:"proposal"`
	}
	if w.Code != 409 || json.Unmarshal(w.Body.Bytes(), &conflict) != nil || conflict.Proposal.ID != create.ID || conflict.Proposal.State != ProposalStateApplied {
		t.Fatalf("second claim: %d %s", w.Code, w.Body.String())
	}
	// 作成の結果を記録すると、解放はできない。
	if w := request(h, "PATCH", proposalPath(1, create.ID), `{"state":"applied","createdItemNumber":12}`); w.Code != 200 {
		t.Fatalf("record: %d %s", w.Code, w.Body.String())
	}
	if w := request(h, "PATCH", proposalPath(1, create.ID), `{"state":"pending"}`); w.Code != 409 {
		t.Fatalf("release after record: %d", w.Code)
	}
	// ステータスの提案: 確保 → 解放 → 破棄。
	for _, step := range []struct {
		body string
		code int
	}{{`{"state":"applied"}`, 200}, {`{"state":"pending"}`, 200}, {`{"state":"dismissed"}`, 200}, {`{"state":"applied"}`, 409}} {
		if w := request(h, "PATCH", proposalPath(1, status.ID), step.body); w.Code != step.code {
			t.Fatalf("%s: %d %s", step.body, w.Code, w.Body.String())
		}
	}
	got := assistantProposals(t, f.repo, 1, f.admin.ID, cid)
	if got[0].State != ProposalStateApplied || *got[0].CreatedItemNumber != 12 || got[1].State != ProposalStateDismissed {
		t.Fatalf("stored=%+v", got)
	}
}

// 受け入れ条件（保存と再読み込み・二重適用・新旧の同居）: MySQL。
func TestProjectAIProposalsMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := context.Background()
	// 起動のたびに呼ばれても壊れない（提案のテーブルも冪等）。
	for range 2 {
		if err := repo.InitializeProjectAIChat(ctx); err != nil {
			t.Fatal(err)
		}
	}
	member, _ := mysqlSecondUserAndProject(t, repo)
	cid := proposalTurn(t, repo, 1, admin.ID, createDraft("作る"), ProjectAIProposalDraft{Kind: ProposalKindDescriptionEdit,
		ItemNumber: ptrTo(int64(1)), ItemTitle: ptrTo("t"), Description: ptrTo("新"), BaseDescription: ptrTo("")})
	list := assistantProposals(t, repo, 1, admin.ID, cid)
	if len(list) != 2 || list[0].State != ProposalStatePending || *list[0].ColumnName != "Todo" ||
		list[1].BaseDescription == nil || *list[1].BaseDescription != "" || list[1].ColumnID != nil {
		t.Fatalf("proposals=%+v", list)
	}
	id := list[0].ID
	if _, err := repo.UpdateProjectAIProposal(ctx, 1, member.ID, id, ProjectAIProposalChange{State: ProposalStateApplied}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user: %v", err)
	}
	if _, err := repo.UpdateProjectAIProposal(ctx, 1, admin.ID, id, ProjectAIProposalChange{State: ProposalStateApplied}); err != nil {
		t.Fatal(err)
	}
	if cur, err := repo.UpdateProjectAIProposal(ctx, 1, admin.ID, id, ProjectAIProposalChange{State: ProposalStateApplied}); !errors.Is(err, ErrProposalConflict) || cur.ID != id {
		t.Fatalf("second claim: %+v %v", cur, err)
	}
	n := int64(77)
	if p, err := repo.UpdateProjectAIProposal(ctx, 1, admin.ID, id, ProjectAIProposalChange{State: ProposalStateApplied, CreatedItemNumber: &n}); err != nil || *p.CreatedItemNumber != 77 {
		t.Fatalf("record: %+v %v", p, err)
	}
	if got := assistantProposals(t, repo, 1, admin.ID, cid); got[0].State != ProposalStateApplied || *got[0].CreatedItemNumber != 77 {
		t.Fatalf("reloaded=%+v", got[0])
	}
	count := func() int {
		var c int
		if err := repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_ai_proposals WHERE user_id=?`, admin.ID).Scan(&c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	// 古い版の SQL（提案のテーブルを知らない）でメッセージ・会話を消しても、提案は一緒に消える。
	if _, err := repo.DB.ExecContext(ctx, `DELETE FROM project_ai_messages WHERE conversation_id=?`, cid); err != nil {
		t.Fatal(err)
	}
	if c := count(); c != 0 {
		t.Fatalf("after deleting messages: %d", c)
	}
	cid = proposalTurn(t, repo, 1, admin.ID, createDraft("二"))
	if _, err := repo.DB.ExecContext(ctx, `DELETE FROM project_ai_conversations WHERE id=?`, cid); err != nil {
		t.Fatal(err)
	}
	if c := count(); c != 0 {
		t.Fatalf("after deleting the conversation: %d", c)
	}
}

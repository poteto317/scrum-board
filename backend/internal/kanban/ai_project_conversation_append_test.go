package kanban

import (
	"context"
	"testing"
)

// ReplaceAndAppend drops id>=, CASCADE-drops their proposals, and leaves the new turn.
func TestReplaceAndAppendProjectAITurnMemory(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{
		Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1,
		Proposals: []ProjectAIProposalDraft{createDraft("旧提案")},
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err = repo.AppendProjectAITurn(ctx, 1, 1, &c.ID, ProjectAITurn{
		UserBody: "q2", AssistantBody: "a2", InputTokens: 2, OutputTokens: 2,
		Proposals: []ProjectAIProposalDraft{createDraft("後の提案")},
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil || len(before) != 4 {
		t.Fatalf("before=%+v err=%v", before, err)
	}
	replaceFrom := before[2].ID // second user message
	droppedAssistantID := before[3].ID

	stored, err := repo.ReplaceAndAppendProjectAITurn(ctx, 1, 1, c.ID, replaceFrom, ProjectAITurn{
		UserBody: "edited", AssistantBody: "new a", InputTokens: 3, OutputTokens: 4,
		Proposals: []ProjectAIProposalDraft{createDraft("新提案")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID != c.ID {
		t.Fatalf("conversation=%+v", stored)
	}
	list, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 4 || list[0].Body != "q1" || list[1].Body != "a1" || list[2].Body != "edited" || list[3].Body != "new a" {
		t.Fatalf("messages=%+v", list)
	}
	if list[2].ID < replaceFrom || list[3].ID <= list[2].ID {
		t.Fatalf("new ids must follow truncate: %+v", list)
	}
	if len(list[1].Proposals) != 1 || *list[1].Proposals[0].Title != "旧提案" {
		t.Fatalf("kept first-turn proposals: %+v", list[1].Proposals)
	}
	if len(list[3].Proposals) != 1 || *list[3].Proposals[0].Title != "新提案" {
		t.Fatalf("new proposals: %+v", list[3].Proposals)
	}
	for _, p := range repo.projectAIProposals {
		if p.MessageID == droppedAssistantID {
			t.Fatalf("proposal of truncated assistant left: %+v", p)
		}
	}
	if len(repo.projectAIProposals) != 2 {
		t.Fatalf("proposals left=%d want 2 (kept first + new)", len(repo.projectAIProposals))
	}
}

// After lock, an earlier user id is refused so a concurrent later turn is not truncated.
func TestReplaceAndAppendProjectAITurnStaleMemory(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	c, err := repo.AppendProjectAITurn(ctx, 1, 1, nil, ProjectAITurn{
		Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err = repo.AppendProjectAITurn(ctx, 1, 1, &c.ID, ProjectAITurn{
		UserBody: "q2", AssistantBody: "a2", InputTokens: 1, OutputTokens: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.ReplaceAndAppendProjectAITurn(ctx, 1, 1, c.ID, before[0].ID, ProjectAITurn{
		UserBody: "edited", AssistantBody: "new a", InputTokens: 1, OutputTokens: 1,
	})
	if err != ErrProjectAIReplaceStale {
		t.Fatalf("err=%v want ErrProjectAIReplaceStale", err)
	}
	got, err := repo.ListProjectAIMessages(ctx, 1, 1, c.ID)
	if err != nil || len(got) != 4 || got[2].Body != "q2" {
		t.Fatalf("history must be unchanged: %+v err=%v", got, err)
	}
}

// Missing conversation becomes a new one (paid answer is not dropped); no prior messages.
func TestReplaceAndAppendProjectAITurnCreatesWhenGoneMemory(t *testing.T) {
	repo := fresh()
	ctx := context.Background()
	missing := int64(99999)
	stored, err := repo.ReplaceAndAppendProjectAITurn(ctx, 1, 1, missing, 1, ProjectAITurn{
		Title: "rescued", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID == 0 || stored.ID == missing || stored.Title != "rescued" {
		t.Fatalf("stored=%+v", stored)
	}
	list, err := repo.ListProjectAIMessages(ctx, 1, 1, stored.ID)
	if err != nil || len(list) != 2 || list[0].Body != "q" || list[1].Body != "a" {
		t.Fatalf("list=%+v err=%v", list, err)
	}
}

func TestReplaceAndAppendProjectAITurnMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{
		Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1,
		Proposals: []ProjectAIProposalDraft{createDraft("旧")},
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err = repo.AppendProjectAITurn(ctx, 1, admin.ID, &c.ID, ProjectAITurn{
		UserBody: "q2", AssistantBody: "a2", InputTokens: 1, OutputTokens: 1,
		Proposals: []ProjectAIProposalDraft{createDraft("消える")},
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
	if err != nil || len(before) != 4 {
		t.Fatalf("before=%+v err=%v", before, err)
	}
	replaceFrom := before[2].ID

	stored, err := repo.ReplaceAndAppendProjectAITurn(ctx, 1, admin.ID, c.ID, replaceFrom, ProjectAITurn{
		UserBody: "edited", AssistantBody: "new a", InputTokens: 5, OutputTokens: 6,
		Proposals: []ProjectAIProposalDraft{createDraft("新")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID != c.ID {
		t.Fatalf("stored=%+v", stored)
	}
	list, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 4 || list[2].Body != "edited" || list[3].Body != "new a" {
		t.Fatalf("messages=%+v", list)
	}
	if n := scalar[int](t, repo.DB, `SELECT COUNT(*) FROM project_ai_proposals WHERE message_id=?`, before[3].ID); n != 0 {
		t.Fatalf("cascaded proposals left on deleted assistant: %d", n)
	}
	if len(list[3].Proposals) != 1 || list[3].Proposals[0].Title == nil || *list[3].Proposals[0].Title != "新" {
		t.Fatalf("new proposals=%+v", list[3].Proposals)
	}
}

// INSERT failure after DELETE must roll back so the old messages remain.
func TestReplaceAndAppendProjectAITurnRollsBackOnInsertFailureMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{
		Title: "t", UserBody: "keep q", AssistantBody: "keep a", InputTokens: 1, OutputTokens: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
	if err != nil || len(before) != 2 {
		t.Fatalf("before=%+v err=%v", before, err)
	}
	mustExec(t, repo.DB, `CREATE TRIGGER fail_project_ai_msg_insert BEFORE INSERT ON project_ai_messages
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test forced insert failure'`)
	t.Cleanup(func() {
		_, _ = repo.DB.Exec(`DROP TRIGGER IF EXISTS fail_project_ai_msg_insert`)
	})

	_, err = repo.ReplaceAndAppendProjectAITurn(ctx, 1, admin.ID, c.ID, before[0].ID, ProjectAITurn{
		UserBody: "edited", AssistantBody: "new a", InputTokens: 1, OutputTokens: 1,
	})
	if err == nil {
		t.Fatal("expected insert failure")
	}
	after, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 2 || after[0].ID != before[0].ID || after[0].Body != "keep q" || after[1].Body != "keep a" {
		t.Fatalf("history must be unchanged after rollback: before=%+v after=%+v", before, after)
	}
}

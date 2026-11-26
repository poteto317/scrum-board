package kanban

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"
)

func mysqlConversationRepo(t *testing.T) (MySQLRepository, User) {
	t.Helper()
	repo := MySQLRepository{DB: mysqlTestDB(t, "")}
	admin, err := repo.GetUserByLoginName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	return repo, admin
}

// 受け入れ条件 7: 保存は、最初に会話の行をロックする。その間、その会話の削除は待たされるので、
// 「会話の確認」と「メッセージの INSERT」の間に消されて外部キーの違反になる、が起きない。
func TestAppendProjectAITurnLockMakesDeleteWaitMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	// 保存の途中: 会話の行を確かめた（ロックした）ところで止まっている。
	tx, err := repo.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	id, found, err := lockProjectAIConversation(ctx, tx, 1, admin.ID, &c.ID)
	if err != nil || !found || id != c.ID {
		t.Fatalf("lock: id=%d found=%v err=%v", id, found, err)
	}
	deleted := make(chan error, 1)
	go func() { deleted <- repo.DeleteProjectAIConversation(context.Background(), 1, admin.ID, c.ID) }()
	select {
	case err := <-deleted:
		t.Fatalf("the delete must wait for the append that checked the conversation first: %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	// 削除が割り込もうとしていても、メッセージの INSERT は外部キーの違反にならない。
	if _, err := tx.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, conversation_id, role, body) VALUES (1, ?, ?, 'user', 'q2')`, admin.ID, c.ID); err != nil {
		t.Fatalf("insert while a delete is waiting: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-deleted:
		if err != nil {
			t.Fatalf("delete after the append: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the delete did not finish after the append committed")
	}
	// 後から来た削除が、足したばかりのメッセージごと消す。
	if n := scalar[int](t, repo.DB, `SELECT COUNT(*) FROM project_ai_messages`); n != 0 {
		t.Fatalf("messages left: %d", n)
	}
	// ほかの持ち主の ID・無い ID は、ロックしない（見つからない）。
	tx2, err := repo.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx2.Rollback()
	missing := int64(987654)
	if _, found, err := lockProjectAIConversation(ctx, tx2, 1, admin.ID, &missing); found || err != nil {
		t.Fatalf("missing: found=%v err=%v", found, err)
	}
	if _, found, err := lockProjectAIConversation(ctx, tx2, 1, admin.ID, nil); found || err != nil {
		t.Fatalf("no id: found=%v err=%v", found, err)
	}
}

// 受け入れ条件 7: 保存と削除が同時に走っても、保存は失敗しない。先に消されていたら、新しい会話になる。
func TestAppendProjectAITurnRacingWithDeleteNeverFailsMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	// 持ち主が違う ID は、同じ 404 として扱われる側（会話を作る側）に入る。
	_, other := mysqlSecondUserAndProject(t, repo)
	if _, err := repo.AppendProjectAITurn(ctx, other.ID, admin.ID, nil, ProjectAITurn{Title: "別プロジェクト", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1}); err != nil {
		t.Fatal(err)
	}
	continued, recreated := 0, 0
	for i := range 40 {
		c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		var stored ProjectAIConversation
		var appendErr, deleteErr error
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			stored, appendErr = repo.AppendProjectAITurn(context.Background(), 1, admin.ID, &c.ID, ProjectAITurn{Title: fmt.Sprintf("round %d", i), UserBody: "late q", AssistantBody: "late a", InputTokens: 1, OutputTokens: 1})
		}()
		go func() {
			defer wg.Done()
			<-start
			// 保存のほうが手数が多いので、削除を少しずつ遅らせて、両方の順序を起こす。
			time.Sleep(time.Duration(i%8) * 300 * time.Microsecond)
			deleteErr = repo.DeleteProjectAIConversation(context.Background(), 1, admin.ID, c.ID)
		}()
		close(start)
		wg.Wait()
		if appendErr != nil {
			t.Fatalf("round %d: storing the answer must not fail when the conversation is deleted meanwhile: %v", i, appendErr)
		}
		if deleteErr != nil {
			t.Fatalf("round %d: delete: %v", i, deleteErr)
		}
		list, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, stored.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, getErr := repo.GetProjectAIConversation(ctx, 1, admin.ID, stored.ID)
		switch {
		case stored.ID == c.ID:
			// 保存が先: 後から来た削除が、会話ごと消した。
			continued++
			if !errors.Is(getErr, ErrNotFound) || len(list) != 0 {
				t.Fatalf("round %d: append first, then delete: get=%v messages=%d", i, getErr, len(list))
			}
		default:
			// 削除が先: 回答は、新しい会話として残る。
			recreated++
			if getErr != nil || stored.Title != fmt.Sprintf("round %d", i) || messageBodies(list) != "late q|late a" {
				t.Fatalf("round %d: delete first, then append: get=%v title=%q messages=%q", i, getErr, stored.Title, messageBodies(list))
			}
		}
		checkProjectAIChatConsistent(t, repo.DB)
	}
	t.Logf("append first: %d, delete first (answer stored in a new conversation): %d", continued, recreated)
}

// 同じ会話への同時の保存は、直列になる（質問と回答の組が、ほかの組と混ざらない）。
func TestAppendProjectAITurnToOneConversationIsSerializedMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	const writers = 8
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stored, err := repo.AppendProjectAITurn(context.Background(), 1, admin.ID, &c.ID, ProjectAITurn{UserBody: fmt.Sprintf("q%d", i), AssistantBody: fmt.Sprintf("a%d", i), InputTokens: 1, OutputTokens: 1})
			if err == nil && stored.ID != c.ID {
				err = fmt.Errorf("stored in %d, want %d", stored.ID, c.ID)
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	list, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
	if err != nil || len(list) != 2+2*writers {
		t.Fatalf("messages=%d err=%v", len(list), err)
	}
	// ID の順に見て、質問のすぐ後に、その回答がある。
	slices.SortFunc(list, func(a, b ProjectAIMessage) int { return cmp.Compare(a.ID, b.ID) })
	for i := 0; i < len(list); i += 2 {
		q, a := list[i], list[i+1]
		if q.Role != AIRoleUser || a.Role != AIRoleAssistant || q.Body[1:] != a.Body[1:] {
			t.Fatalf("pair %d is mixed with another: %q %q", i/2, q.Role+":"+q.Body, a.Role+":"+a.Body)
		}
	}
	if n := scalar[int](t, repo.DB, `SELECT COUNT(*) FROM project_ai_conversations`); n != 1 {
		t.Fatalf("conversations=%d", n)
	}
}

// 上限の刈り込みは、会話を作ることとは別の手順。超えた分だけを、更新が古い順に消し、
// keepID の会話は、いちばん古くても消さない。上限以内なら何も消さない。
func TestTrimProjectAIConversationsMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	insert := func(title, at string) int64 {
		t.Helper()
		res, err := repo.DB.ExecContext(ctx, `INSERT INTO project_ai_conversations(project_id, user_id, title, created_at, updated_at) VALUES (1, ?, ?, ?, ?)`, admin.ID, title, at, at)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	trim := func(keepID int64) {
		t.Helper()
		tx, err := repo.DB.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err := trimProjectAIConversations(ctx, tx, 1, admin.ID, keepID); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	titles := func(where string) int {
		t.Helper()
		return scalar[int](t, repo.DB, `SELECT COUNT(*) FROM project_ai_conversations WHERE `+where)
	}
	kept := insert("kept", "2026-09-01 00:00:00.000000")
	for i := range maxProjectAIConversations - 1 {
		insert(fmt.Sprintf("c%03d", i), fmt.Sprintf("2026-10-01 00:%02d:%02d.000000", i/60, i%60))
	}
	// ちょうど上限: 何も消さない。
	trim(kept)
	if n := titles("1=1"); n != maxProjectAIConversations {
		t.Fatalf("at the limit nothing is deleted: %d", n)
	}
	// 別のユーザーの会話は、数えないし消さない。
	member, _ := mysqlSecondUserAndProject(t, repo)
	mustExec(t, repo.DB, `INSERT INTO project_ai_conversations(project_id, user_id, title, created_at, updated_at) VALUES (1, ?, 'theirs', '2026-08-01', '2026-08-01')`, member.ID)
	trim(kept)
	if n := titles("1=1"); n != maxProjectAIConversations+1 {
		t.Fatalf("another user's conversation is not counted: %d", n)
	}
	// 2 件超える: keepID の次に古い 2 件（c000, c001）が消える。
	insert("new1", "2026-11-01 00:00:00.000000")
	insert("new2", "2026-11-01 00:00:01.000000")
	trim(kept)
	if n := titles("user_id=" + fmt.Sprint(admin.ID)); n != maxProjectAIConversations {
		t.Fatalf("back to the limit: %d", n)
	}
	if n := titles("title IN ('c000','c001')"); n != 0 {
		t.Fatalf("the two oldest besides the kept one must be gone: %d", n)
	}
	if n := titles("title IN ('kept','c002','new1','new2','theirs')"); n != 5 {
		t.Fatalf("the kept one, the newer ones and another user's must stay: %d", n)
	}
}

// 会話を作るだけでは刈り込まない（刈り込みは trimProjectAIConversations）。
func TestCreateProjectAIConversationOnlyInsertsMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	for i := range maxProjectAIConversations {
		at := fmt.Sprintf("2026-10-01 00:%02d:%02d.000000", i/60, i%60)
		mustExec(t, repo.DB, `INSERT INTO project_ai_conversations(project_id, user_id, title, created_at, updated_at) VALUES (1, ?, 'c', ?, ?)`, admin.ID, at, at)
	}
	tx, err := repo.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	id, err := createProjectAIConversation(ctx, tx, 1, admin.ID, "101 件目")
	if err != nil || id <= 0 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_ai_conversations WHERE user_id=?`, admin.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != maxProjectAIConversations+1 {
		t.Fatalf("create must not trim: %d", n)
	}
}

// 報告されなかったトークン数（0 以下）は、0 ではなく NULL で保存する。報告された数はそのまま。
func TestAppendProjectAITurnStoresUnreportedTokensAsNullMySQL(t *testing.T) {
	repo, admin := mysqlConversationRepo(t)
	ctx := t.Context()
	c, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "q1", AssistantBody: "a1", InputTokens: 0, OutputTokens: 0})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, &c.ID, ProjectAITurn{Title: "t", UserBody: "q2", AssistantBody: "a2", InputTokens: 10, OutputTokens: 0}); err != nil {
		t.Fatal(err)
	}
	count := func(where string) int {
		t.Helper()
		return scalar[int](t, repo.DB, `SELECT COUNT(*) FROM project_ai_messages WHERE conversation_id=? AND `+where, c.ID)
	}
	if n := count("role='user' AND input_tokens IS NULL AND output_tokens IS NULL"); n != 2 {
		t.Fatalf("the user's messages carry no tokens: %d", n)
	}
	if n := count("body='a1' AND input_tokens IS NULL AND output_tokens IS NULL"); n != 1 {
		t.Fatalf("unreported tokens must be NULL: %d", n)
	}
	if n := count("body='a2' AND input_tokens=10 AND output_tokens IS NULL"); n != 1 {
		t.Fatalf("a reported count is stored, an unreported one next to it is NULL: %d", n)
	}
}

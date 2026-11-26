package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// legacyProjectAIMessagesDDL is project_ai_messages as it was before the conversations
// (card #146): what an existing database has when this version starts for the first time.
const legacyProjectAIMessagesDDL = `CREATE TABLE project_ai_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL,
  body TEXT NOT NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_message_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_ai_message_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_ai_message_role CHECK (role IN ('user', 'assistant')),
  INDEX project_ai_messages_scope (project_id, user_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

var autoIncrementOption = regexp.MustCompile(` AUTO_INCREMENT=\d+`)

// tableShape is SHOW CREATE TABLE without the AUTO_INCREMENT counter: columns, indexes and
// constraints, in the order MySQL keeps them.
func tableShape(t *testing.T, db *sql.DB, table string) string {
	t.Helper()
	var name, ddl string
	if err := db.QueryRow("SHOW CREATE TABLE "+table).Scan(&name, &ddl); err != nil {
		t.Fatal(err)
	}
	return autoIncrementOption.ReplaceAllString(ddl, "")
}

func scalar[T any](t *testing.T, db *sql.DB, query string, args ...any) T {
	t.Helper()
	var v T
	if err := db.QueryRow(query, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return v
}

// projectAIChatShapes are the shapes of both tables.
type projectAIChatShapes struct{ conversations, messages string }

func projectAIChatShapesOf(t *testing.T, db *sql.DB) projectAIChatShapes {
	t.Helper()
	return projectAIChatShapes{conversations: tableShape(t, db, "project_ai_conversations"), messages: tableShape(t, db, "project_ai_messages")}
}

type legacyProjectAIChat struct {
	db            *sql.DB
	repo          MySQLRepository
	admin, member User
	other         Project
	// fresh is the shape database/init/001_schema.sql gives a new database.
	fresh projectAIChatShapes
}

// legacyProjectAIChatDB gives a database whose project chat tables are as they were before
// the conversations: project_ai_messages without conversation_id, no project_ai_conversations.
func legacyProjectAIChatDB(t *testing.T) legacyProjectAIChat {
	t.Helper()
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	admin, err := repo.GetUserByLoginName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	member, other := mysqlSecondUserAndProject(t, repo)
	l := legacyProjectAIChat{db: db, repo: repo, admin: admin, member: member, other: other, fresh: projectAIChatShapesOf(t, db)}
	mustExec(t, db, `DROP TABLE project_ai_messages`)
	mustExec(t, db, `DROP TABLE project_ai_conversations`)
	mustExec(t, db, legacyProjectAIMessagesDDL)
	return l
}

// legacyMessage inserts a message the way the older server did: no conversation.
func legacyMessage(t *testing.T, db *sql.DB, projectID, userID int64, role, body, createdAt string) {
	t.Helper()
	mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, role, body, created_at) VALUES (?,?,?,?,?)`, projectID, userID, role, body, createdAt)
}

// messageRows is every message as text: id, owner, role, body and time, in id order.
func messageRows(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT CONCAT_WS('/', id, project_id, user_id, role, body, COALESCE(input_tokens, '-'), COALESCE(output_tokens, '-'), CAST(created_at AS CHAR)) FROM project_ai_messages ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// conversationRows is every conversation as text, in id order.
func conversationRows(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT CONCAT_WS('/', id, project_id, user_id, title, CAST(created_at AS CHAR), CAST(updated_at AS CHAR)) FROM project_ai_conversations ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// checkProjectAIChatConsistent: every message is in a conversation of the same owner, and no
// conversation is empty.
func checkProjectAIChatConsistent(t *testing.T, db *sql.DB) {
	t.Helper()
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages WHERE conversation_id IS NULL`); n != 0 {
		t.Fatalf("messages without a conversation: %d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages m LEFT JOIN project_ai_conversations c ON c.id=m.conversation_id
 WHERE c.id IS NULL OR c.project_id<>m.project_id OR c.user_id<>m.user_id`); n != 0 {
		t.Fatalf("messages whose owner differs from their conversation's: %d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations c WHERE NOT EXISTS (SELECT 1 FROM project_ai_messages m WHERE m.conversation_id=c.id)`); n != 0 {
		t.Fatalf("conversations without a message: %d", n)
	}
}

// 受け入れ条件 8: 既存の形のテーブル（conversation_id が無く、行がある）から起動時の初期化を走らせる。
func TestInitializeProjectAIChatUpgradesAnExistingDatabaseMySQL(t *testing.T) {
	l := legacyProjectAIChatDB(t)
	db, ctx := l.db, t.Context()
	long := strings.Repeat("長", 45)
	// admin × プロジェクト 1: 最初の行は回答（タイトルは、最初の user のメッセージから）。
	legacyMessage(t, db, 1, l.admin.ID, AIRoleAssistant, "先にある回答", "2026-11-01 09:00:00.000001")
	legacyMessage(t, db, 1, l.admin.ID, AIRoleUser, "  最初の   質問\nです ", "2026-11-01 09:00:01.000002")
	legacyMessage(t, db, 1, l.admin.ID, AIRoleAssistant, "回答", "2026-11-03 10:11:12.123456")
	// member × プロジェクト 1: user のメッセージが無い。
	legacyMessage(t, db, 1, l.member.ID, AIRoleAssistant, "回答だけ", "2026-11-02 08:00:00.500000")
	// admin × 別プロジェクト: 長いタイトル。時刻の順は、ID の順と逆。
	legacyMessage(t, db, l.other.ID, l.admin.ID, AIRoleAssistant, "後の回答", "2026-11-05 00:00:00.000000")
	legacyMessage(t, db, l.other.ID, l.admin.ID, AIRoleUser, long, "2026-11-04 00:00:00.000000")
	mustExec(t, db, `UPDATE project_ai_messages SET input_tokens=11, output_tokens=22 WHERE body='回答'`)
	before := messageRows(t, db)
	if len(before) != 6 {
		t.Fatalf("seeded rows=%d", len(before))
	}

	if err := l.repo.InitializeProjectAIChat(ctx); err != nil {
		t.Fatal(err)
	}

	// 列・索引・外部キーが足されている。
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_messages' AND COLUMN_NAME='conversation_id' AND IS_NULLABLE='YES' AND DATA_TYPE='bigint'`); n != 1 {
		t.Fatalf("conversation_id BIGINT NULL: %d", n)
	}
	if got := scalar[string](t, db, `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_messages' AND INDEX_NAME='project_ai_messages_conversation'`); got != "conversation_id,created_at,id" {
		t.Fatalf("index columns=%q", got)
	}
	if got := scalar[string](t, db, `SELECT CONCAT(REFERENCED_TABLE_NAME, '/', DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_messages' AND CONSTRAINT_NAME='fk_project_ai_message_conversation'`); got != "project_ai_conversations/CASCADE" {
		t.Fatalf("foreign key=%q", got)
	}
	// 移行したテーブルの形は、新しく作ったテーブル（001_schema.sql）と同じ。外部キー用の索引が別に作られていない。
	migrated := projectAIChatShapesOf(t, db)
	if migrated.messages != l.fresh.messages {
		t.Fatalf("migrated project_ai_messages differs from the schema file's:\n--- migrated\n%s\n--- schema file\n%s", migrated.messages, l.fresh.messages)
	}
	if migrated.conversations != l.fresh.conversations {
		t.Fatalf("project_ai_conversations differs from the schema file's:\n--- created\n%s\n--- schema file\n%s", migrated.conversations, l.fresh.conversations)
	}

	// 引き継ぎ: プロジェクト × ユーザーごとに 1 つの会話。メッセージの ID・時刻・中身は変えない。
	checkProjectAIChatConsistent(t, db)
	if after := messageRows(t, db); strings.Join(after, "\n") != strings.Join(before, "\n") {
		t.Fatalf("messages must keep their ids, bodies and times:\n%s\n---\n%s", strings.Join(before, "\n"), strings.Join(after, "\n"))
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations`); n != 3 {
		t.Fatalf("conversations=%d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(DISTINCT project_id, user_id) FROM project_ai_conversations`); n != 3 {
		t.Fatalf("one conversation per project × user: %d scopes", n)
	}
	conversation := func(projectID, userID int64) string {
		t.Helper()
		return scalar[string](t, db, `SELECT CONCAT_WS('/', title, CAST(created_at AS CHAR), CAST(updated_at AS CHAR)) FROM project_ai_conversations WHERE project_id=? AND user_id=?`, projectID, userID)
	}
	// タイトルは最初の user のメッセージから。時刻は、最初と最後のメッセージの時刻。
	if got := conversation(1, l.admin.ID); got != "最初の 質問 です/2026-11-01 09:00:00.000001/2026-11-03 10:11:12.123456" {
		t.Fatalf("admin × 1: %s", got)
	}
	if got := conversation(1, l.member.ID); got != "これまでの会話/2026-11-02 08:00:00.500000/2026-11-02 08:00:00.500000" {
		t.Fatalf("member × 1: %s", got)
	}
	if got := conversation(l.other.ID, l.admin.ID); got != strings.Repeat("長", 40)+"…/2026-11-04 00:00:00.000000/2026-11-05 00:00:00.000000" {
		t.Fatalf("admin × other: %s", got)
	}
	// 新しい版の読み取りに、引き継いだ会話がそのまま出る。
	list, err := l.repo.ListProjectAIConversations(ctx, 1, l.admin.ID)
	if err != nil || len(list) != 1 || list[0].Title != "最初の 質問 です" {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	messages, err := l.repo.ListProjectAIMessages(ctx, 1, l.admin.ID, list[0].ID)
	if err != nil || messageBodies(messages) != "先にある回答|  最初の   質問\nです |回答" {
		t.Fatalf("messages=%q err=%v", messageBodies(messages), err)
	}
	if messages[2].InputTokens == nil || *messages[2].InputTokens != 11 || *messages[2].OutputTokens != 22 || messages[2].ConversationID != list[0].ID {
		t.Fatalf("tokens and conversation: %+v", messages[2])
	}

	// 2 回実行しても、何も変わらない（会話は増えず、形も同じ）。
	conversations := conversationRows(t, db)
	for range 2 {
		if err := l.repo.InitializeProjectAIChat(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := conversationRows(t, db); strings.Join(got, "\n") != strings.Join(conversations, "\n") {
		t.Fatalf("a second run must change nothing:\n%s\n---\n%s", strings.Join(conversations, "\n"), strings.Join(got, "\n"))
	}
	if got := messageRows(t, db); strings.Join(got, "\n") != strings.Join(before, "\n") {
		t.Fatal("a second run must not touch the messages")
	}
	if got := projectAIChatShapesOf(t, db); got != migrated {
		t.Fatalf("a second run must not change the tables:\n%s\n%s", got.messages, got.conversations)
	}
	// 終わったら、ロックは残っていない。
	if free := scalar[int](t, db, `SELECT IS_FREE_LOCK(?)`, projectAIChatMigrateLock); free != 1 {
		t.Fatal("the migration lock must be released")
	}
}

// 新しく作ったテーブル（起動時の DDL）の形も、001_schema.sql と同じ。
func TestInitializeProjectAIChatCreatesTheSchemaFileShapeMySQL(t *testing.T) {
	l := legacyProjectAIChatDB(t)
	mustExec(t, l.db, `DROP TABLE project_ai_messages`)
	for range 2 {
		if err := l.repo.InitializeProjectAIChat(t.Context()); err != nil {
			t.Fatal(err)
		}
		if got := projectAIChatShapesOf(t, l.db); got != l.fresh {
			t.Fatalf("tables created at startup differ from the schema file's:\n%s\n%s\n--- schema file\n%s\n%s", got.conversations, got.messages, l.fresh.conversations, l.fresh.messages)
		}
	}
	// 形に入っているもの: NULL を許す列、2 つの索引、3 つの外部キー（外部キー用に別の索引は無い）。
	for _, want := range []string{
		"`conversation_id` bigint DEFAULT NULL",
		"KEY `project_ai_messages_scope` (`project_id`,`user_id`,`created_at`,`id`)",
		"KEY `project_ai_messages_conversation` (`conversation_id`,`created_at`,`id`)",
		"CONSTRAINT `fk_project_ai_message_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `project_ai_conversations` (`id`) ON DELETE CASCADE",
	} {
		if !strings.Contains(l.fresh.messages, want) {
			t.Fatalf("project_ai_messages lacks %q:\n%s", want, l.fresh.messages)
		}
	}
	if strings.Contains(l.fresh.messages, "KEY `fk_project_ai_message_conversation`") {
		t.Fatalf("no separate index for the foreign key:\n%s", l.fresh.messages)
	}
	for _, want := range []string{
		"`title` varchar(120) NOT NULL",
		"`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),",
		"KEY `project_ai_conversations_scope` (`project_id`,`user_id`,`updated_at`,`id`)",
		"CONSTRAINT `fk_project_ai_conversation_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE",
		"CONSTRAINT `fk_project_ai_conversation_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE",
	} {
		if !strings.Contains(l.fresh.conversations, want) {
			t.Fatalf("project_ai_conversations lacks %q:\n%s", want, l.fresh.conversations)
		}
	}
}

// 受け入れ条件 14: 起動時の初期化を並行して実行しても、会話は組ごとに 1 件で、空の会話が残らない。
func TestInitializeProjectAIChatInParallelMySQL(t *testing.T) {
	l := legacyProjectAIChatDB(t)
	db := l.db
	scopes := [][2]int64{{1, l.admin.ID}, {1, l.member.ID}, {l.other.ID, l.admin.ID}, {l.other.ID, l.member.ID}}
	for i, s := range scopes {
		for j := range 6 {
			role := AIRoleUser
			if j%2 == 1 {
				role = AIRoleAssistant
			}
			legacyMessage(t, db, s[0], s[1], role, fmt.Sprintf("scope%d-%d", i, j), fmt.Sprintf("2026-11-0%d 00:00:0%d.000000", i+1, j))
		}
	}
	parallel := func(n int) {
		t.Helper()
		var wg sync.WaitGroup
		errs := make(chan error, n)
		start := make(chan struct{})
		for range n {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				errs <- l.repo.InitializeProjectAIChat(context.Background())
			}()
		}
		close(start)
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatalf("parallel initialization: %v", err)
			}
		}
	}
	perScope := func(want int) {
		t.Helper()
		for _, s := range scopes {
			if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=? AND user_id=?`, s[0], s[1]); n != want {
				t.Fatalf("scope %v: %d conversations, want %d", s, n, want)
			}
		}
	}
	// 既存の形から、2 つのインスタンスが同時に起動する（本番の最大）。
	parallel(2)
	perScope(1)
	checkProjectAIChatConsistent(t, db)
	if got := projectAIChatShapesOf(t, db); got != l.fresh {
		t.Fatalf("shape after a parallel upgrade:\n%s\n%s", got.conversations, got.messages)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages`); n != 24 {
		t.Fatalf("messages=%d", n)
	}

	// 入れ替えの途中: 古い版が会話なしのメッセージを足し、古い版の「クリア」が空の会話を残した。
	for i, s := range scopes {
		mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, role, body) VALUES (?,?,?,?)`, s[0], s[1], AIRoleUser, fmt.Sprintf("old server %d", i))
		mustExec(t, db, `INSERT INTO project_ai_conversations(project_id, user_id, title) VALUES (?,?,?)`, s[0], s[1], "空の会話")
	}
	parallel(4)
	// 組ごとに、前の会話と、古い版のメッセージをまとめた会話の 2 件。空の会話は残らない。
	perScope(2)
	checkProjectAIChatConsistent(t, db)
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE title='空の会話'`); n != 0 {
		t.Fatalf("empty conversations left: %d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages`); n != 28 {
		t.Fatalf("messages=%d", n)
	}
	parallel(3)
	perScope(2)
}

// 全体がロックの中: ほかのインスタンスが移行している間は、何もせずに待つ。
func TestInitializeProjectAIChatWaitsForTheMigrationLockMySQL(t *testing.T) {
	l := legacyProjectAIChatDB(t)
	legacyMessage(t, l.db, 1, l.admin.ID, AIRoleUser, "q", "2026-11-01 00:00:00.000000")
	holder, err := l.db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	var locked int
	if err := holder.QueryRowContext(t.Context(), `SELECT GET_LOCK(?, 0)`, projectAIChatMigrateLock).Scan(&locked); err != nil || locked != 1 {
		t.Fatalf("holding the lock: %d %v", locked, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 700*time.Millisecond)
	defer cancel()
	if err := l.repo.InitializeProjectAIChat(ctx); err == nil {
		t.Fatal("initialization must not run while another one holds the lock")
	}
	if n := scalar[int](t, l.db, `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_conversations'`); n != 0 {
		t.Fatal("nothing may be migrated outside the lock")
	}
	if n := scalar[int](t, l.db, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_messages' AND COLUMN_NAME='conversation_id'`); n != 0 {
		t.Fatal("nothing may be migrated outside the lock")
	}
	if _, err := holder.ExecContext(t.Context(), `DO RELEASE_LOCK(?)`, projectAIChatMigrateLock); err != nil {
		t.Fatal(err)
	}
	if err := l.repo.InitializeProjectAIChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, l.db, `SELECT COUNT(*) FROM project_ai_conversations`); n != 1 {
		t.Fatalf("conversations=%d", n)
	}
	checkProjectAIChatConsistent(t, l.db)
}

// ロックの待ち時間が過ぎた（GET_LOCK が 0 を返した）: エラーになり、テーブルに触らず、
// ほかの接続が持つロックも解放しない。
func TestInitializeProjectAIChatFailsWhenTheMigrationLockTimesOutMySQL(t *testing.T) {
	l := legacyProjectAIChatDB(t)
	legacyMessage(t, l.db, 1, l.admin.ID, AIRoleUser, "q", "2026-11-01 00:00:00.000000")
	holder, err := l.db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	var locked int
	if err := holder.QueryRowContext(t.Context(), `SELECT GET_LOCK(?, 0)`, projectAIChatMigrateLock).Scan(&locked); err != nil || locked != 1 {
		t.Fatalf("holding the lock: %d %v", locked, err)
	}
	// ctx には期限を付けない: 終わるのは、GET_LOCK の待ち時間（ここでは 1 秒）が過ぎたから。
	started := time.Now()
	err = l.repo.initializeProjectAIChat(t.Context(), 1)
	if !errors.Is(err, errProjectAIChatMigrateLockBusy) {
		t.Fatalf("want the lock to be reported busy, got %v", err)
	}
	if waited := time.Since(started); waited < 900*time.Millisecond {
		t.Fatalf("must wait for the lock before giving up: %v", waited)
	}
	if n := scalar[int](t, l.db, `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_conversations'`); n != 0 {
		t.Fatal("nothing may be migrated without the lock")
	}
	if n := scalar[int](t, l.db, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_ai_messages' AND COLUMN_NAME='conversation_id'`); n != 0 {
		t.Fatal("nothing may be migrated without the lock")
	}
	var stillHeld sql.NullBool
	if err := holder.QueryRowContext(t.Context(), `SELECT IS_USED_LOCK(?) = CONNECTION_ID()`, projectAIChatMigrateLock).Scan(&stillHeld); err != nil || !stillHeld.Bool {
		t.Fatalf("the other connection must still hold the lock: %v %v", stillHeld, err)
	}
	if _, err := holder.ExecContext(t.Context(), `DO RELEASE_LOCK(?)`, projectAIChatMigrateLock); err != nil {
		t.Fatal(err)
	}
	if err := l.repo.InitializeProjectAIChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	checkProjectAIChatConsistent(t, l.db)
}

// 本番の待ち時間は 30 秒のまま。
func TestProjectAIChatMigrateLockSeconds(t *testing.T) {
	if projectAIChatMigrateLockSeconds != 30 {
		t.Fatalf("projectAIChatMigrateLockSeconds=%d", projectAIChatMigrateLockSeconds)
	}
}

// 入れ替えの途中と巻き戻し: 古い版が新しいスキーマの上で書いたものは失敗せず、次の起動で整う。
func TestOlderServerOnTheNewSchemaIsRepairedAtTheNextStartMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	kept, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "新しい版の会話", UserBody: "new q", AssistantBody: "new a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "古い版に消される会話", UserBody: "gone q", AssistantBody: "gone a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	// 古い版の送信: conversation_id なしで足す（列は NULL を許し、外部キーは NULL に効かない）。
	mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, role, body) VALUES (?,?,?,?)`, 1, admin.ID, AIRoleUser, "old server q")
	mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, role, body) VALUES (?,?,?,?)`, 1, admin.ID, AIRoleAssistant, "old server a")
	// その行は、引き継がれるまで、新しい版ではどの会話にも出ない。
	for _, c := range []ProjectAIConversation{kept, cleared} {
		list, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, c.ID)
		if err != nil || len(list) != 2 {
			t.Fatalf("conversation %d: %d messages, err=%v", c.ID, len(list), err)
		}
	}
	// 古い版の「履歴をクリア」に当たる動き: ある会話のメッセージだけが消え、会話の行が残る。
	mustExec(t, db, `DELETE FROM project_ai_messages WHERE conversation_id=?`, cleared.ID)
	if list, _ := repo.ListProjectAIConversations(ctx, 1, admin.ID); len(list) != 2 {
		t.Fatalf("before the next start the empty conversation is still listed: %d", len(list))
	}

	if err := repo.InitializeProjectAIChat(ctx); err != nil {
		t.Fatal(err)
	}
	checkProjectAIChatConsistent(t, db)
	list, err := repo.ListProjectAIConversations(ctx, 1, admin.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	var adopted *ProjectAIConversation
	for i, c := range list {
		switch c.ID {
		case kept.ID:
		case cleared.ID:
			t.Fatal("the empty conversation must be deleted at startup")
		default:
			adopted = &list[i]
		}
	}
	if adopted == nil || adopted.Title != "old server q" {
		t.Fatalf("the older server's messages must become a conversation: %+v", list)
	}
	messages, err := repo.ListProjectAIMessages(ctx, 1, admin.ID, adopted.ID)
	if err != nil || messageBodies(messages) != "old server q|old server a" {
		t.Fatalf("adopted=%q err=%v", messageBodies(messages), err)
	}
	// 新しい版の「全部消す」は、会話に属していない古い行も消す。
	mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, role, body) VALUES (?,?,?,?)`, 1, admin.ID, AIRoleUser, "another old row")
	if err := repo.ClearProjectAIConversations(ctx, 1, admin.ID); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, db, `SELECT (SELECT COUNT(*) FROM project_ai_messages) + (SELECT COUNT(*) FROM project_ai_conversations)`); n != 0 {
		t.Fatalf("clear must delete conversations and stray messages: %d left", n)
	}
}

// 引き継ぎでは 100 件の上限を刈り込まない（一時的に 101 件）。次に会話を作るときに、超えた分が全部消える。
func TestAdoptionDoesNotTrimButTheNextNewConversationDoesMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	for i := range maxProjectAIConversations {
		at := fmt.Sprintf("2026-10-01 00:%02d:%02d.000000", i/60, i%60)
		res, err := db.ExecContext(ctx, `INSERT INTO project_ai_conversations(project_id, user_id, title, created_at, updated_at) VALUES (1, ?, ?, ?, ?)`, admin.ID, fmt.Sprintf("c%03d", i), at, at)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		mustExec(t, db, `INSERT INTO project_ai_messages(project_id, user_id, conversation_id, role, body, created_at) VALUES (1, ?, ?, 'user', 'q', ?)`, admin.ID, id, at)
	}
	// 引き継がれる行は、どの会話よりも古い。
	legacyMessage(t, db, 1, admin.ID, AIRoleUser, "引き継がれる質問", "2026-09-01 00:00:00.000000")
	if err := repo.InitializeProjectAIChat(ctx); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE user_id=?`, admin.ID); n != maxProjectAIConversations+1 {
		t.Fatalf("adoption must not trim: %d", n)
	}
	// 一覧は 100 件まで（いちばん古い、引き継いだ会話が外れる）。
	list, err := repo.ListProjectAIConversations(ctx, 1, admin.ID)
	if err != nil || len(list) != maxProjectAIConversations || list[0].Title != "c099" || list[99].Title != "c000" {
		t.Fatalf("list: n=%d err=%v", len(list), err)
	}
	// 次に会話を作ると 102 件になり、超えた 2 件（更新が古い順）が消えて 100 件に戻る。
	created, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "新しい会話です", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1})
	if err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE user_id=?`, admin.ID); n != maxProjectAIConversations {
		t.Fatalf("after the next new conversation: %d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE title IN ('引き継がれる質問', 'c000')`); n != 0 {
		t.Fatalf("the two oldest must be gone: %d left", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE id=? OR title='c001'`, created.ID); n != 2 {
		t.Fatalf("the new one and the third oldest must stay: %d", n)
	}
	checkProjectAIChatConsistent(t, db)
}

// 引き継ぐ行が無い組では、会話を作らない（空の会話を残さない）。
func TestAdoptProjectAIMessagesOfWithNothingToAdoptMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	admin, err := (MySQLRepository{DB: db}).GetUserByLoginName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := adoptProjectAIMessagesOf(t.Context(), conn, 1, admin.ID); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations`); n != 0 {
		t.Fatalf("conversations=%d", n)
	}
}

// 引き継ぐ対象の組は、会話に属していない行がある組だけ。同じ組は 1 回、プロジェクト・ユーザーの順。
func TestProjectAIScopesWithoutConversationMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	member, other := mysqlSecondUserAndProject(t, repo)
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if scopes, err := projectAIScopesWithoutConversation(ctx, conn); err != nil || len(scopes) != 0 {
		t.Fatalf("nothing to adopt: %+v err=%v", scopes, err)
	}
	// 会話に属している行だけの組（プロジェクト 1 × member）は、対象にならない。
	if _, err := repo.AppendProjectAITurn(ctx, 1, member.ID, nil, ProjectAITurn{Title: "t", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1}); err != nil {
		t.Fatal(err)
	}
	legacyMessage(t, db, other.ID, member.ID, AIRoleUser, "q", "2026-10-01 00:00:00.000000")
	legacyMessage(t, db, 1, admin.ID, AIRoleUser, "q1", "2026-10-01 00:00:01.000000")
	legacyMessage(t, db, 1, admin.ID, AIRoleAssistant, "a1", "2026-10-01 00:00:02.000000")
	scopes, err := projectAIScopesWithoutConversation(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	want := []projectAIScope{{projectID: 1, userID: admin.ID}, {projectID: other.ID, userID: member.ID}}
	if other.ID < 1 {
		t.Fatalf("the second project must come after project 1: %d", other.ID)
	}
	if len(scopes) != len(want) || scopes[0] != want[0] || scopes[1] != want[1] {
		t.Fatalf("scopes=%+v want %+v", scopes, want)
	}
}

// 引き継ぐ会話のタイトルは、会話に属していない行のうち、最初の user のメッセージから。
// user のメッセージが無ければ「これまでの会話」。
func TestAdoptedProjectAIConversationTitleMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	title := func() string {
		t.Helper()
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		got, err := adoptedProjectAIConversationTitle(ctx, tx, 1, admin.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	// 会話に属している user のメッセージは、いちばん古くても使わない。
	if _, err := repo.AppendProjectAITurn(ctx, 1, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "もう会話にある質問", AssistantBody: "a", InputTokens: 1, OutputTokens: 1}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE project_ai_messages SET created_at='2026-01-01 00:00:00.000000'`)
	legacyMessage(t, db, 1, admin.ID, AIRoleAssistant, "回答だけ", "2026-10-01 00:00:00.000000")
	if got := title(); got != projectAIConversationTitleAdopted {
		t.Fatalf("without a user message: %q", got)
	}
	legacyMessage(t, db, 1, admin.ID, AIRoleUser, "二つ目の質問", "2026-10-01 00:00:02.000000")
	legacyMessage(t, db, 1, admin.ID, AIRoleUser, "  最初の\n質問  ", "2026-10-01 00:00:01.000000")
	if got := title(); got != "最初の 質問" {
		t.Fatalf("from the first user message: %q", got)
	}
}

// shortLockWaitConn gives a connection that gives up waiting for a row lock after one second
// (the server's default is 50 seconds): a lock wait timeout (1205) without a slow test.
func shortLockWaitConn(t *testing.T, db *sql.DB) *sql.Conn {
	t.Helper()
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	if _, err := conn.ExecContext(t.Context(), `SET SESSION innodb_lock_wait_timeout=1`); err != nil {
		t.Fatal(err)
	}
	return conn
}

// heldBeyondALockWait is how long the other transaction keeps its locks: longer than one lock
// wait of shortLockWaitConn (1 to 2 seconds), shorter than three of them.
const heldBeyondALockWait = 2200 * time.Millisecond

// 動いているサーバーが会話とメッセージを保存している途中（未コミット）に掃除が走っても、ロック待ちの
// 時間切れ（1205）で起動を失敗させず、その会話を消さない。コミットの後も、会話とメッセージが残る。
func TestDeleteEmptyProjectAIConversationsKeepsAConversationBeingStoredMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := t.Context()
	admin, err := (MySQLRepository{DB: db}).GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	// 保存のトランザクション: 会話を作ったところで、まだメッセージが無い。
	storing, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer storing.Rollback()
	res, err := storing.ExecContext(ctx, `INSERT INTO project_ai_conversations(project_id, user_id, title) VALUES (?,?,?)`, 1, admin.ID, "保存の途中")
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	conn := shortLockWaitConn(t, db)
	cleaned := make(chan error, 1)
	go func() { cleaned <- deleteEmptyProjectAIConversations(ctx, conn) }()
	select {
	case err := <-cleaned:
		t.Fatalf("the cleanup must wait for the conversation that is being stored, but ended: %v", err)
	case <-time.After(heldBeyondALockWait):
	}
	for _, role := range []string{AIRoleUser, AIRoleAssistant} {
		if _, err := storing.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, conversation_id, role, body) VALUES (?,?,?,?,?)`, 1, admin.ID, id, role, "本文"); err != nil {
			t.Fatal(err)
		}
	}
	if err := storing.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-cleaned; err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE id=?`, id); n != 1 {
		t.Fatalf("the stored conversation must stay: %d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages WHERE conversation_id=?`, id); n != 2 {
		t.Fatalf("its messages must stay: %d", n)
	}
	checkProjectAIChatConsistent(t, db)
}

// 引き継ぐ行を、動いているサーバー（古い版の刈り込みなど）がロックしている間に引き継ぎが走っても、
// ロック待ちの時間切れ（1205）で起動を失敗させず、やり直して引き継ぐ。
func TestAdoptProjectAIMessagesOfRetriesWhileTheRowsAreLockedMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := t.Context()
	admin, err := (MySQLRepository{DB: db}).GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	legacyMessage(t, db, 1, admin.ID, AIRoleUser, "古い質問", "2026-11-01 00:00:00.000000")
	legacyMessage(t, db, 1, admin.ID, AIRoleAssistant, "古い回答", "2026-11-01 00:00:01.000000")
	locking, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer locking.Rollback()
	if _, err := locking.ExecContext(ctx, `SELECT id FROM project_ai_messages WHERE project_id=? AND user_id=? FOR UPDATE`, 1, admin.ID); err != nil {
		t.Fatal(err)
	}
	conn := shortLockWaitConn(t, db)
	adopted := make(chan error, 1)
	go func() { adopted <- adoptProjectAIMessagesOf(ctx, conn, 1, admin.ID) }()
	select {
	case err := <-adopted:
		t.Fatalf("the adoption must wait for the locked rows, but ended: %v", err)
	case <-time.After(heldBeyondALockWait):
	}
	if err := locking.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-adopted; err != nil {
		t.Fatalf("adoption: %v", err)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_conversations WHERE title='古い質問'`); n != 1 {
		t.Fatalf("conversations=%d", n)
	}
	if n := scalar[int](t, db, `SELECT COUNT(*) FROM project_ai_messages`); n != 2 {
		t.Fatalf("messages=%d", n)
	}
	checkProjectAIChatConsistent(t, db)
}

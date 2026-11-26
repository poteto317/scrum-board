package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

// checkProjectAIHistoryScope is the storage contract of the project chat, run against both the
// memory repository and MySQL: conversations per project × user (newest update first, 100 at
// most), messages per conversation (oldest first, 200 at most), nothing of another user or project.
func checkProjectAIHistoryScope(t *testing.T, repo Repository, projectA, projectB, userA, userB int64) {
	t.Helper()
	ctx := context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	turn := func(projectID, userID int64, conversationID *int64, title, q, a string, inTok, outTok int64) ProjectAIConversation {
		t.Helper()
		c, err := repo.AppendProjectAITurn(ctx, projectID, userID, conversationID, ProjectAITurn{Title: title, UserBody: q, AssistantBody: a, InputTokens: inTok, OutputTokens: outTok})
		must(err)
		if c.ID == 0 || c.ProjectID != projectID || c.CreatedAt.IsZero() || c.UpdatedAt.Before(c.CreatedAt) {
			t.Fatalf("stored conversation=%+v", c)
		}
		return c
	}
	bodies := func(projectID, userID, conversationID int64) string {
		t.Helper()
		list, err := repo.ListProjectAIMessages(ctx, projectID, userID, conversationID)
		must(err)
		if list == nil {
			t.Fatal("no messages must be an empty slice, not nil")
		}
		var out []string
		for _, m := range list {
			if m.ProjectID != projectID || m.ConversationID != conversationID || m.ID == 0 || m.CreatedAt.IsZero() {
				t.Fatalf("message=%+v", m)
			}
			out = append(out, m.Role+":"+m.Body)
		}
		return strings.Join(out, "|")
	}
	ids := func(projectID, userID int64) []int64 {
		t.Helper()
		list, err := repo.ListProjectAIConversations(ctx, projectID, userID)
		must(err)
		if list == nil {
			t.Fatal("no conversations must be an empty slice, not nil")
		}
		out := make([]int64, 0, len(list))
		for _, c := range list {
			if c.ProjectID != projectID {
				t.Fatalf("conversation of another project: %+v", c)
			}
			out = append(out, c.ID)
		}
		return out
	}
	latest := func(projectID, userID int64) int64 {
		t.Helper()
		c, err := repo.LatestProjectAIConversation(ctx, projectID, userID)
		must(err)
		if c == nil {
			return 0
		}
		return c.ID
	}
	if len(ids(projectA, userA)) != 0 || latest(projectA, userA) != 0 {
		t.Fatal("a fresh scope has no conversation")
	}

	// 会話は、ID なしの保存で作られる。ID を付ければ、その会話に続く（タイトルは変わらない）。
	c1 := turn(projectA, userA, nil, "話題1", "a-A q1", "a-A a1", 10, 20)
	if c1.Title != "話題1" {
		t.Fatalf("title=%q", c1.Title)
	}
	again := turn(projectA, userA, &c1.ID, "使われないタイトル", "a-A q2", "a-A a2", 0, 0)
	if again.ID != c1.ID || again.Title != "話題1" || !again.CreatedAt.Equal(c1.CreatedAt) || again.UpdatedAt.Before(c1.UpdatedAt) {
		t.Fatalf("continuing must keep the conversation: first=%+v again=%+v", c1, again)
	}
	c2 := turn(projectA, userA, nil, "話題2", "a-A other q", "a-A other a", 1, 1)
	cB := turn(projectB, userA, nil, "別プロジェクト", "b-A q", "b-A a", 1, 1)
	cU := turn(projectA, userB, nil, "別ユーザー", "a-B q", "a-B a", 1, 1)
	if c2.ID == c1.ID || cB.ID == c1.ID || cU.ID == c1.ID {
		t.Fatal("every new conversation has its own id")
	}
	if got := bodies(projectA, userA, c1.ID); got != "user:a-A q1|assistant:a-A a1|user:a-A q2|assistant:a-A a2" {
		t.Fatalf("conversation 1=%q", got)
	}
	if got := bodies(projectA, userA, c2.ID); got != "user:a-A other q|assistant:a-A other a" {
		t.Fatalf("conversation 2=%q", got)
	}
	// トークンは、回答にだけ付く。0 は「無い」。
	list, err := repo.ListProjectAIMessages(ctx, projectA, userA, c1.ID)
	must(err)
	if list[0].InputTokens != nil || list[1].InputTokens == nil || *list[1].InputTokens != 10 || *list[1].OutputTokens != 20 ||
		list[3].InputTokens != nil || list[3].OutputTokens != nil {
		t.Fatalf("tokens=%+v", list)
	}

	// 一覧は、そのプロジェクト × ユーザーのものだけで、更新の新しい順。続きを保存すると先頭に来る。
	if got := ids(projectA, userA); !slices.Equal(got, []int64{c2.ID, c1.ID}) || latest(projectA, userA) != c2.ID {
		t.Fatalf("list=%v want %v", got, []int64{c2.ID, c1.ID})
	}
	turn(projectA, userA, &c1.ID, "", "a-A q3", "a-A a3", 1, 1)
	if got := ids(projectA, userA); !slices.Equal(got, []int64{c1.ID, c2.ID}) || latest(projectA, userA) != c1.ID {
		t.Fatalf("after continuing conversation 1: list=%v", got)
	}
	if got := ids(projectB, userA); !slices.Equal(got, []int64{cB.ID}) {
		t.Fatalf("project B × user A=%v", got)
	}
	if got := ids(projectA, userB); !slices.Equal(got, []int64{cU.ID}) {
		t.Fatalf("project A × user B=%v", got)
	}
	if len(ids(projectB, userB)) != 0 || latest(projectB, userB) != 0 {
		t.Fatal("project B × user B has nothing")
	}

	// 別のユーザー・別のプロジェクトからは、無いのと同じ（取得・メッセージ・削除）。
	for _, wrong := range []struct{ projectID, userID int64 }{{projectA, userB}, {projectB, userA}, {projectB, userB}} {
		if _, err := repo.GetProjectAIConversation(ctx, wrong.projectID, wrong.userID, c1.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("get from %+v: %v", wrong, err)
		}
		if got := bodies(wrong.projectID, wrong.userID, c1.ID); got != "" {
			t.Fatalf("messages from %+v: %q", wrong, got)
		}
		if err := repo.DeleteProjectAIConversation(ctx, wrong.projectID, wrong.userID, c1.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("delete from %+v: %v", wrong, err)
		}
	}
	if _, err := repo.GetProjectAIConversation(ctx, projectA, userA, 987654); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id: %v", err)
	}
	if got, err := repo.GetProjectAIConversation(ctx, projectA, userA, c1.ID); err != nil || got.ID != c1.ID || got.Title != "話題1" {
		t.Fatalf("own conversation: %+v %v", got, err)
	}
	// 他人の会話の ID で保存しても、その会話には足されない。自分の新しい会話になる。
	stray := turn(projectA, userB, &c1.ID, "他人の ID", "stray q", "stray a", 1, 1)
	if stray.ID == c1.ID || bodies(projectA, userB, stray.ID) != "user:stray q|assistant:stray a" ||
		bodies(projectA, userA, c1.ID) != "user:a-A q1|assistant:a-A a1|user:a-A q2|assistant:a-A a2|user:a-A q3|assistant:a-A a3" {
		t.Fatalf("someone else's conversation id must not be written to: stray=%+v", stray)
	}

	// 会話の削除は、その会話とそのメッセージだけ。
	must(repo.DeleteProjectAIConversation(ctx, projectA, userA, c2.ID))
	if got := ids(projectA, userA); !slices.Equal(got, []int64{c1.ID}) || bodies(projectA, userA, c2.ID) != "" {
		t.Fatalf("after delete: list=%v", got)
	}
	if bodies(projectA, userA, c1.ID) == "" || bodies(projectB, userA, cB.ID) == "" || bodies(projectA, userB, cU.ID) == "" {
		t.Fatal("deleting one conversation must not touch another")
	}
	if err := repo.DeleteProjectAIConversation(ctx, projectA, userA, c2.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	// 消された会話への保存は、失敗せずに新しい会話になる（渡したタイトルが付く）。
	reborn := turn(projectA, userA, &c2.ID, "消された後", "late q", "late a", 1, 1)
	if reborn.ID == c2.ID || reborn.Title != "消された後" || bodies(projectA, userA, reborn.ID) != "user:late q|assistant:late a" {
		t.Fatalf("append to a deleted conversation: %+v", reborn)
	}

	// クリアは、そのプロジェクト × ユーザーの会話を全部。
	must(repo.ClearProjectAIConversations(ctx, projectA, userA))
	if len(ids(projectA, userA)) != 0 || bodies(projectA, userA, c1.ID) != "" || bodies(projectA, userA, reborn.ID) != "" {
		t.Fatal("clearing must delete every conversation of the scope")
	}
	if !slices.Equal(ids(projectB, userA), []int64{cB.ID}) || len(ids(projectA, userB)) != 2 || bodies(projectA, userB, cU.ID) == "" {
		t.Fatal("clearing must not touch another project or another user")
	}

	// 200 件を超えた分は、その会話の古い順に消える。同じ持ち主の別の会話は減らない。
	long := turn(projectA, userA, nil, "長い会話", "u000", "a000", 1, 2)
	side := turn(projectA, userA, nil, "横の会話", "side q", "side a", 1, 1)
	for i := 1; i < 100; i++ {
		turn(projectA, userA, &long.ID, "", fmt.Sprintf("u%03d", i), fmt.Sprintf("a%03d", i), 1, 2)
	}
	turn(projectA, userA, &long.ID, "", "newest-u", "newest-a", 3, 4)
	list, err = repo.ListProjectAIMessages(ctx, projectA, userA, long.ID)
	must(err)
	if len(list) != maxAIChatStoredMessages {
		t.Fatalf("want %d, got %d", maxAIChatStoredMessages, len(list))
	}
	if list[0].Body != "u001" || list[1].Body != "a001" || list[198].Body != "newest-u" || list[199].Body != "newest-a" {
		t.Fatalf("head=%q %q tail=%q %q", list[0].Body, list[1].Body, list[198].Body, list[199].Body)
	}
	if bodies(projectA, userA, side.ID) != "user:side q|assistant:side a" || bodies(projectB, userA, cB.ID) != "user:b-A q|assistant:b-A a" ||
		bodies(projectA, userB, cU.ID) != "user:a-B q|assistant:a-B a" {
		t.Fatal("trimming must not touch another conversation, project or user")
	}

	// 会話は 100 件まで。101 件目を作ると、更新がいちばん古い 1 件（とそのメッセージ）が消える。
	// いま 2 件（long, side。long のほうが後に更新された）。あと 98 件で 100 件。
	var made []ProjectAIConversation
	for i := range maxProjectAIConversations - 2 {
		made = append(made, turn(projectA, userA, nil, fmt.Sprintf("会話%03d", i), "q", "a", 1, 1))
	}
	if got := ids(projectA, userA); len(got) != maxProjectAIConversations || got[len(got)-1] != side.ID || got[len(got)-2] != long.ID {
		t.Fatalf("100 conversations, oldest update last: n=%d tail=%v", len(got), got[len(got)-2:])
	}
	// いちばん古い side に続きを足すと、long がいちばん古くなる。
	turn(projectA, userA, &side.ID, "", "side q2", "side a2", 1, 1)
	extra := turn(projectA, userA, nil, "101 件目", "q", "a", 1, 1)
	got := ids(projectA, userA)
	if len(got) != maxProjectAIConversations || got[0] != extra.ID || slices.Contains(got, long.ID) || !slices.Contains(got, side.ID) || !slices.Contains(got, made[0].ID) {
		t.Fatalf("the conversation with the oldest update must go: n=%d first=%d", len(got), got[0])
	}
	if _, err := repo.GetProjectAIConversation(ctx, projectA, userA, long.ID); !errors.Is(err, ErrNotFound) || bodies(projectA, userA, long.ID) != "" {
		t.Fatalf("the trimmed conversation and its messages must be gone: %v", err)
	}
	if !slices.Equal(ids(projectB, userA), []int64{cB.ID}) || len(ids(projectA, userB)) != 2 {
		t.Fatal("the limit is per project × user")
	}
}

func TestProjectAIHistoryScopeMemory(t *testing.T) {
	f := newToolFixture(t)
	checkProjectAIHistoryScope(t, f.repo, 1, f.other.ID, f.admin.ID, f.member.ID)
	// プロジェクトを消すと、会話も履歴も消える（MySQL の ON DELETE CASCADE と同じ）。
	if err := f.repo.DeleteProject(context.Background(), f.other.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := f.repo.ListProjectAIConversations(context.Background(), f.other.ID, f.admin.ID); len(list) != 0 {
		t.Fatalf("conversations of a deleted project=%d", len(list))
	}
	if len(projectHistory(t, f.repo, f.other.ID, f.admin.ID)) != 0 {
		t.Fatal("history of a deleted project must be gone")
	}
}

// squashSQL removes the layout differences between the Go DDL and the schema file.
func squashSQL(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func TestProjectAIMessagesDDLMatchesSchemaFile(t *testing.T) {
	schema, err := os.ReadFile("../../../database/init/001_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := squashSQL(string(schema))
	if !strings.Contains(text, squashSQL(projectAIMessagesDDL)+";") {
		t.Fatal("database/init/001_schema.sql must contain the same project_ai_messages DDL as projectAIMessagesDDL")
	}
	if !strings.Contains(text, squashSQL(projectAIConversationsDDL)+";") {
		t.Fatal("database/init/001_schema.sql must contain the same project_ai_conversations DDL as projectAIConversationsDDL")
	}
	if !strings.Contains(text, squashSQL(projectAIProposalsDDL)+";") {
		t.Fatal("database/init/001_schema.sql must contain the same project_ai_proposals DDL as projectAIProposalsDDL")
	}
	// 提案はメッセージを参照するので、メッセージより後に置く。
	if p, m := strings.Index(text, "CREATE TABLE IF NOT EXISTS project_ai_proposals"), strings.Index(text, "CREATE TABLE IF NOT EXISTS project_ai_messages"); p < m {
		t.Fatal("project_ai_proposals must come after project_ai_messages")
	}
	// users を参照するので、users より後に置く。メッセージは会話を参照するので、会話より後に置く。
	users := strings.Index(text, "CREATE TABLE IF NOT EXISTS users")
	conversations := strings.Index(text, "CREATE TABLE IF NOT EXISTS project_ai_conversations")
	messages := strings.Index(text, "CREATE TABLE IF NOT EXISTS project_ai_messages")
	if users < 0 || !(users < conversations && conversations < messages) {
		t.Fatalf("order in the schema file must be users < project_ai_conversations < project_ai_messages: %d %d %d", users, conversations, messages)
	}
	// 列は NULL を許したまま（入れ替えの途中に、古い版が会話なしで足す）。updated_at はアプリが書く。
	if !strings.Contains(squashSQL(projectAIMessagesDDL), "conversation_id BIGINT NULL,") {
		t.Fatal("conversation_id must stay NULLable")
	}
	if strings.Contains(projectAIConversationsDDL, "ON UPDATE") {
		t.Fatal("project_ai_conversations.updated_at is written by the application, not by ON UPDATE")
	}
}

func mysqlSecondUserAndProject(t *testing.T, repo MySQLRepository) (User, Project) {
	t.Helper()
	member, err := repo.CreateUser(t.Context(), UserCreateInput{LoginName: "member1", DisplayName: "メンバー", Password: "member-pass", Role: RoleMember})
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateProject(t.Context(), "別プロジェクト")
	if err != nil {
		t.Fatal(err)
	}
	return member, other
}

func TestProjectAIHistoryScopeMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	// 起動のたびに呼ばれても壊れない。
	if err := repo.InitializeProjectAIChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	admin, err := repo.GetUserByLoginName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	member, other := mysqlSecondUserAndProject(t, repo)
	checkProjectAIHistoryScope(t, repo, 1, other.ID, admin.ID, member.ID)

	// 存在しないプロジェクトには足せない（外部キー）。会話も残らない。
	if _, err := repo.AppendProjectAITurn(t.Context(), 99999, admin.ID, nil, ProjectAITurn{Title: "t", UserBody: "q", AssistantBody: "a", InputTokens: 1, OutputTokens: 1}); err == nil {
		t.Fatal("appending to a missing project must fail")
	}
	count := func(query string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=99999`); n != 0 {
		t.Fatalf("a failed append must not leave a conversation: %d", n)
	}
	// メッセージの持ち主は、会話の行と同じ（持ち主は 2 か所にある）。会話の無いメッセージ・メッセージの無い会話は無い。
	if n := count(`SELECT COUNT(*) FROM project_ai_messages m LEFT JOIN project_ai_conversations c ON c.id=m.conversation_id
 WHERE c.id IS NULL OR c.project_id<>m.project_id OR c.user_id<>m.user_id`); n != 0 {
		t.Fatalf("messages whose owner differs from their conversation's: %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM project_ai_conversations c WHERE NOT EXISTS (SELECT 1 FROM project_ai_messages m WHERE m.conversation_id=c.id)`); n != 0 {
		t.Fatalf("conversations without a message: %d", n)
	}
	// プロジェクトを消すと、そのプロジェクトの会話と履歴だけが消える。
	mainMessages := count(`SELECT COUNT(*) FROM project_ai_messages WHERE project_id=1`)
	mainConversations := count(`SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=1`)
	if count(`SELECT COUNT(*) FROM project_ai_messages WHERE project_id=?`, other.ID) != 2 || count(`SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=?`, other.ID) != 1 {
		t.Fatal("before delete: the other project has one conversation with two messages")
	}
	if err := repo.DeleteProject(t.Context(), other.ID); err != nil {
		t.Fatal(err)
	}
	if count(`SELECT COUNT(*) FROM project_ai_messages WHERE project_id=?`, other.ID) != 0 || count(`SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=?`, other.ID) != 0 {
		t.Fatal("project delete must cascade to its conversations and messages")
	}
	if count(`SELECT COUNT(*) FROM project_ai_messages WHERE project_id=1`) != mainMessages || count(`SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=1`) != mainConversations || mainConversations < maxProjectAIConversations {
		t.Fatalf("the other project's history must stay: conversations=%d messages=%d", mainConversations, mainMessages)
	}
}

func TestSearchProjectItemsMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	_, other := mysqlSecondUserAndProject(t, repo)
	// スキーマの初期データを片づけて、このテストのアイテムだけにする。
	seeded, err := repo.SearchProjectItems(ctx, 1, ItemSearch{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range seeded {
		if err := repo.HardDeleteItem(ctx, it.ID); err != nil {
			t.Fatal(err)
		}
	}
	mk := func(in ItemInput) Item {
		t.Helper()
		if in.ColumnID == 0 {
			in.ColumnID = 1
		}
		card, err := repo.CreateItem(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		return card
	}
	setDue := func(card Item, at time.Time) {
		t.Helper()
		if _, err := repo.UpdateItem(ctx, card.ID, ItemPatch{DueAt: &at}); err != nil {
			t.Fatal(err)
		}
	}
	numbers := func(s ItemSearch) []int64 {
		t.Helper()
		items, err := repo.SearchProjectItems(ctx, 1, s)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]int64, 0, len(items))
		for _, it := range items {
			if it.ProjectID != 1 || it.DeletedAt != nil {
				t.Fatalf("item outside the scope: %+v", it)
			}
			out = append(out, it.Number)
		}
		return out
	}
	sorted := func(s ItemSearch) []int64 {
		out := numbers(s)
		slices.Sort(out)
		return out
	}

	byTitle := mk(ItemInput{Title: "OAuth の導入", Description: "説明", Assignee: "Sato"})
	byDesc := mk(ItemInput{Title: "別件A", Description: "ここで oauth を使う", ColumnID: 2, Assignee: "sato"})
	bySolution := mk(ItemInput{Title: "別件B", Solution: "OAUTH で解決", Assignee: "Suzuki"})
	byComment := mk(ItemInput{Title: "別件C"})
	if _, err := repo.CreateComment(ctx, byComment.ID, "a", "コメントに OAuth と書いた", 1); err != nil {
		t.Fatal(err)
	}
	percent := mk(ItemInput{Title: "進捗 100% 達成", Description: `パスは c:\temp`})
	plain := mk(ItemInput{Title: "進捗 1000 達成", Description: "a_b ではなく axb"})
	underscore := mk(ItemInput{Title: "記号", Description: "snake_case を使う"})
	trashed := mk(ItemInput{Title: "OAuth ゴミ箱"})
	if err := repo.DeleteItem(ctx, trashed.ID); err != nil {
		t.Fatal(err)
	}
	archived := mk(ItemInput{Title: "OAuth アーカイブ"})
	if _, err := db.ExecContext(ctx, `UPDATE items SET archived_at=NOW(6) WHERE id=?`, archived.ID); err != nil {
		t.Fatal(err)
	}
	mk(ItemInput{Title: "OAuth 別プロジェクト", ProjectID: &other.ID})

	// タイトル・説明・ソリューション・コメント（大文字小文字を区別しない）。ゴミ箱と別プロジェクトは出ない。アーカイブは出る。
	if got := sorted(ItemSearch{Terms: []string{"oauth"}}); !slices.Equal(got, []int64{byTitle.Number, byDesc.Number, bySolution.Number, byComment.Number, archived.Number}) {
		t.Fatalf("fields: %v", got)
	}
	items, err := repo.SearchProjectItems(ctx, 1, ItemSearch{Terms: []string{"アーカイブ"}})
	if err != nil || len(items) != 1 || items[0].ArchivedAt == nil {
		t.Fatalf("archived item must come back with archivedAt: %+v err=%v", items, err)
	}
	// 語は AND。
	if got := numbers(ItemSearch{Terms: []string{"oauth", "導入"}}); !slices.Equal(got, []int64{byTitle.Number}) {
		t.Fatalf("AND: %v", got)
	}
	// 番号（#N でも N でも）。本文に無くても一致する。
	for _, term := range []string{fmt.Sprintf("#%d", byComment.Number), fmt.Sprintf("%d", byComment.Number)} {
		if got := numbers(ItemSearch{Terms: []string{term}}); !slices.Contains(got, byComment.Number) {
			t.Fatalf("number %q: %v", term, got)
		}
	}
	if got := numbers(ItemSearch{Terms: []string{"oauth", fmt.Sprintf("#%d", byTitle.Number)}}); !slices.Equal(got, []int64{byTitle.Number}) {
		t.Fatalf("number AND text: %v", got)
	}
	// LIKE の記号は文字として扱う。
	if got := numbers(ItemSearch{Terms: []string{"100%"}}); !slices.Equal(got, []int64{percent.Number}) {
		t.Fatalf("%% must be literal: %v", got)
	}
	if got := numbers(ItemSearch{Terms: []string{"%"}}); !slices.Equal(got, []int64{percent.Number}) {
		t.Fatalf("a lone %% must not match everything: %v", got)
	}
	if got := numbers(ItemSearch{Terms: []string{"a_b"}}); !slices.Equal(got, []int64{plain.Number}) {
		t.Fatalf("_ must be literal (axb must not match): %v", got)
	}
	if got := sorted(ItemSearch{Terms: []string{"_"}}); !slices.Equal(got, []int64{plain.Number, underscore.Number}) {
		t.Fatalf("a lone _ must not match everything: %v", got)
	}
	if got := numbers(ItemSearch{Terms: []string{`c:\temp`}}); !slices.Equal(got, []int64{percent.Number}) {
		t.Fatalf("backslash must be literal: %v", got)
	}
	// 列。
	doing := int64(2)
	if got := numbers(ItemSearch{Terms: []string{"oauth"}, ColumnID: &doing}); !slices.Equal(got, []int64{byDesc.Number}) {
		t.Fatalf("column: %v", got)
	}
	// 担当（完全一致、大文字小文字を区別しない）。
	if got := sorted(ItemSearch{Assignee: "SATO"}); !slices.Equal(got, []int64{byTitle.Number, byDesc.Number}) {
		t.Fatalf("assignee: %v", got)
	}
	if got := numbers(ItemSearch{Assignee: "Sat"}); len(got) != 0 {
		t.Fatalf("assignee must be an exact match: %v", got)
	}
	// 期限: 範囲（下限を含み、上限を含まない）と、期限の近い順（期限なしは最後）。
	setDue(bySolution, time.Date(2026, 11, 30, 3, 0, 0, 0, time.UTC))
	setDue(byTitle, time.Date(2026, 11, 27, 3, 0, 0, 0, time.UTC))
	setDue(byDesc, time.Date(2026, 11, 28, 15, 0, 0, 0, time.UTC))
	if got := numbers(ItemSearch{Terms: []string{"oauth"}, SortByDue: true}); !slices.Equal(got, []int64{byTitle.Number, byDesc.Number, bySolution.Number, byComment.Number, archived.Number}) {
		t.Fatalf("sort by due: %v", got)
	}
	from := time.Date(2026, 11, 28, 15, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 30, 3, 0, 0, 0, time.UTC)
	if got := numbers(ItemSearch{DueFrom: &from, SortByDue: true}); !slices.Equal(got, []int64{byDesc.Number, bySolution.Number}) {
		t.Fatalf("dueFrom is inclusive and drops items without a due date: %v", got)
	}
	if got := numbers(ItemSearch{DueTo: &to, SortByDue: true}); !slices.Equal(got, []int64{byTitle.Number, byDesc.Number}) {
		t.Fatalf("dueTo is exclusive: %v", got)
	}
	if got := numbers(ItemSearch{DueFrom: &from, DueTo: &to}); !slices.Equal(got, []int64{byDesc.Number}) {
		t.Fatalf("range: %v", got)
	}
	// 既定は、更新の新しい順（期限を付けた順に更新された）。
	if got := numbers(ItemSearch{Terms: []string{"別件"}}); len(got) != 3 || got[0] != byDesc.Number || got[1] != bySolution.Number || got[2] != byComment.Number {
		t.Fatalf("sort by update: %v", got)
	}
	// 別プロジェクトは、そのプロジェクトの検索にだけ出る。
	elsewhere, err := repo.SearchProjectItems(ctx, other.ID, ItemSearch{Terms: []string{"oauth"}})
	if err != nil || len(elsewhere) != 1 || elsewhere[0].Title != "OAuth 別プロジェクト" {
		t.Fatalf("other project: %+v err=%v", elsewhere, err)
	}
}

func TestSearchProjectItemsReturnsAtMost201MySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	var values []string
	var args []any
	for i := range 205 {
		values = append(values, "(1, 1, ?, '', ?)")
		args = append(args, fmt.Sprintf("大量 %03d", i), 1000+i)
	}
	res, err := db.ExecContext(t.Context(), `INSERT INTO items(column_id, project_id, title, description, position) VALUES `+strings.Join(values, ","), args...)
	if err != nil {
		t.Fatal(err)
	}
	first, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), `INSERT INTO item_numbers(item_id, item_number, project_id) SELECT id, 5000 + id, 1 FROM items WHERE id >= ?`, first); err != nil {
		t.Fatal(err)
	}
	items, err := repo.SearchProjectItems(t.Context(), 1, ItemSearch{Terms: []string{"大量"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != maxItemSearchMatches+1 {
		t.Fatalf("want %d rows (one more than is looked at), got %d", maxItemSearchMatches+1, len(items))
	}
}

func TestProjectItemSearchSQLEscapesAndBinds(t *testing.T) {
	col := int64(2)
	from := time.Date(2026, 11, 26, 0, 0, 0, 0, tokyo)
	query, args := projectItemSearchSQL(7, ItemSearch{Terms: []string{"50%_QQQ", "#12"}, ColumnID: &col, Assignee: "Sato", DueFrom: &from, SortByDue: true, Viewer: ItemSearchViewer{UserID: 7341}})
	// 利用者の語と閲覧者の ID は、SQL の文字列には入らない（すべてプレースホルダー）。
	for _, leaked := range []string{"50", "QQQ", "Sato", "#12", "7341"} {
		if strings.Contains(query, leaked) {
			t.Fatalf("user text %q must be bound, not concatenated: %s", leaked, query)
		}
	}
	if !strings.Contains(query, "c.project_id=? AND c.deleted_at IS NULL") || !strings.HasSuffix(query, "LIMIT 201") ||
		!strings.Contains(query, "ORDER BY c.due_at IS NULL, c.due_at ASC") || strings.Count(query, "n.item_number=?") != 1 {
		t.Fatalf("query=%s", query)
	}
	if strings.Count(query, "?") != len(args) {
		t.Fatalf("placeholders=%d args=%d", strings.Count(query, "?"), len(args))
	}
	// 閲覧の条件は、LIMIT より前（WHERE の中）にあり、閲覧者の ID は作成者と許可の一覧の 2 か所に束縛される。
	if !strings.Contains(query, "c.created_by_user_id=?") || !strings.Contains(query, "item_acl_entries e WHERE e.item_id=c.id AND e.user_id=?") ||
		strings.Index(query, "c.view_access") > strings.Index(query, "ORDER BY") {
		t.Fatalf("view condition: %s", query)
	}
	want := `%50\%\_QQQ%`
	if args[6] != want || args[0] != int64(7) || args[1] != int64(7341) || args[2] != int64(7341) || args[len(args)-1] != int64(12) {
		t.Fatalf("args=%v", args)
	}
	if due, ok := args[5].(time.Time); !ok || due.Location() != time.UTC || !due.Equal(from) {
		t.Fatalf("due bound must be sent as UTC: %v", args[5])
	}
	// 管理者は、作成者と許可の一覧を見ない（束縛する値も無い）。
	query, args = projectItemSearchSQL(7, ItemSearch{Viewer: ItemSearchViewer{UserID: 7341, Admin: true}})
	if strings.Contains(query, "item_acl_entries") || !strings.Contains(query, "c.view_access") || len(args) != 1 {
		t.Fatalf("admin query=%s args=%v", query, args)
	}
	query, _ = projectItemSearchSQL(7, ItemSearch{})
	if !strings.Contains(query, "ORDER BY c.updated_at DESC, c.id DESC") {
		t.Fatalf("default order: %s", query)
	}
}

// ツールを MySQL の上で通す: 検索の SQL、閲覧の判定、コメントの読み込みがつながっていること。
func TestProjectToolsRespectACLOnMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	member, other := mysqlSecondUserAndProject(t, repo)
	open, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "ZZTOOL 公開", Description: "公開の説明"})
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := repo.CreateItem(ctx, ItemInput{ColumnID: 2, Title: "ZZTOOL 制限つき", Description: "SECRET-BODY"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ReplaceItemACL(ctx, hidden.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateComment(ctx, hidden.ID, "admin", "ZZTOOL のコメント", admin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "ZZTOOL 別プロジェクト", ProjectID: &other.ID}); err != nil {
		t.Fatal(err)
	}
	columns, err := repo.Columns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, numbers := searchNumbers(t, newProjectToolExecutor(repo, 1, &member, columns), `{"query":"zztool"}`)
	if !slices.Equal(numbers, []int64{open.Number}) {
		t.Fatalf("member sees %v", numbers)
	}
	out, numbers := searchNumbers(t, newProjectToolExecutor(repo, 1, &admin, columns), `{"query":"zztool","status":"doing"}`)
	if !slices.Equal(numbers, []int64{hidden.Number}) || out.Items[0].Status != "Doing" || !strings.Contains(out.Items[0].Snippet, "SECRET-BODY") {
		t.Fatalf("admin sees %v %+v", numbers, out.Items)
	}
	notFound := toolErrorResult(toolErrItemNotFound)
	memberTools := newProjectToolExecutor(repo, 1, &member, columns)
	if got := runTool(t, memberTools, toolGetItem, fmt.Sprintf(`{"number":%d}`, hidden.Number)); got != notFound {
		t.Fatalf("hidden item: %s", got)
	}
	if got := runTool(t, memberTools, toolGetItem, `{"number":987654}`); got != notFound {
		t.Fatalf("missing item: %s", got)
	}
	got := runTool(t, newProjectToolExecutor(repo, 1, &admin, columns), toolGetItem, fmt.Sprintf(`{"number":%d}`, hidden.Number))
	if !strings.Contains(got, "SECRET-BODY") || !strings.Contains(got, "ZZTOOL のコメント") || !strings.Contains(got, `"status":"Doing"`) {
		t.Fatalf("admin get_item: %s", got)
	}
}

func mysqlToolUsers(t *testing.T, repo MySQLRepository) (admin, member User, columns []Column) {
	t.Helper()
	admin, err := repo.GetUserByLoginName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	member, _ = mysqlSecondUserAndProject(t, repo)
	if columns, err = repo.Columns(t.Context()); err != nil {
		t.Fatal(err)
	}
	return admin, member, columns
}

func TestSearchProjectItemsCountsOnlyViewableMatchesMySQL(t *testing.T) {
	repo := MySQLRepository{DB: mysqlTestDB(t, "")}
	admin, member, columns := mysqlToolUsers(t, repo)
	checkSearchCountsOnlyViewableMatches(t, repo, admin, member, columns)
}

func TestSearchProjectItemsHiddenCommentMatchIsNotCountedMySQL(t *testing.T) {
	repo := MySQLRepository{DB: mysqlTestDB(t, "")}
	admin, member, columns := mysqlToolUsers(t, repo)
	checkHiddenCommentMatchIsNotCounted(t, repo, admin, member, columns)
}

// SQL の閲覧条件が CanView と同じ答えを出すこと: 公開・open・restricted（と、保存されうる変な値）×
// 作成者・閲覧の許可・編集の許可・許可なし・管理者。
func TestProjectItemSearchViewConditionMatchesCanViewMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := t.Context()
	admin, err := repo.GetUserByLoginName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	user := func(login string, role string) User {
		t.Helper()
		u, err := repo.CreateUser(ctx, UserCreateInput{LoginName: login, DisplayName: login, Password: "test-pass-1", Role: role})
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	creator, viewAllowed, editAllowed, stranger := user("creator1", RoleMember), user("viewer1", RoleMember), user("editor1", RoleMember), user("stranger1", RoleMember)
	secondAdmin := user("admin2", RoleAdmin)
	viewers := map[string]User{"admin": admin, "second admin": secondAdmin, "creator": creator, "view allowed": viewAllowed, "edit allowed": editAllowed, "not allowed": stranger}

	var ids []int64
	labels := map[int64]string{}
	// "" は open として読まれる。"PUBLIC"・"bogus" は、どの値でもない（誰にも見えない）。
	for _, view := range []string{ViewAccessPublic, ViewAccessOpen, ViewAccessRestricted, "", "PUBLIC", "Restricted", "bogus"} {
		for _, edit := range []string{EditAccessOpen, EditAccessRestricted} {
			for _, withCreator := range []bool{true, false} {
				for _, withEntries := range []bool{true, false} {
					card, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "ZZACL"})
					if err != nil {
						t.Fatal(err)
					}
					var createdBy any
					if withCreator {
						createdBy = creator.ID
					}
					mustExec(t, db, `UPDATE items SET view_access=?, edit_access=?, created_by_user_id=? WHERE id=?`, view, edit, createdBy, card.ID)
					if withEntries {
						mustExec(t, db, `INSERT INTO item_acl_entries(item_id,user_id,capability) VALUES (?,?,?)`, card.ID, viewAllowed.ID, ACLCapabilityView)
						mustExec(t, db, `INSERT INTO item_acl_entries(item_id,user_id,capability) VALUES (?,?,?)`, card.ID, editAllowed.ID, ACLCapabilityEdit)
					}
					ids = append(ids, card.ID)
					labels[card.ID] = fmt.Sprintf("view=%q edit=%q creator=%v entries=%v", view, edit, withCreator, withEntries)
				}
			}
		}
	}
	entries, err := repo.ListACLEntriesForItems(ctx, ids)
	if err != nil {
		t.Fatal(err)
	}
	visibleSomewhere, hiddenSomewhere := false, false
	for name, viewer := range viewers {
		rows, err := repo.SearchProjectItems(ctx, 1, ItemSearch{Terms: []string{"zzacl"}, Viewer: itemSearchViewer(&viewer)})
		if err != nil {
			t.Fatal(err)
		}
		found := map[int64]bool{}
		for _, it := range rows {
			found[it.ID] = true
		}
		for _, id := range ids {
			// CanView が見るのと同じ状態を、行と許可の一覧から作る（loadItemACLState と同じ作り方）。
			var view, edit string
			var createdBy sql.NullInt64
			if err := db.QueryRowContext(ctx, `SELECT view_access, edit_access, created_by_user_id FROM items WHERE id=?`, id).Scan(&view, &edit, &createdBy); err != nil {
				t.Fatal(err)
			}
			state := ItemACLState{ViewAccess: view, EditAccess: edit, ViewUserIDs: entries[id].ViewUserIDs, EditUserIDs: entries[id].EditUserIDs}
			if createdBy.Valid {
				state.CreatedByUserID = &createdBy.Int64
			}
			want := CanView(state, &viewer)
			if found[id] != want {
				t.Errorf("%s / %s: SQL=%v CanView=%v", name, labels[id], found[id], want)
			}
			visibleSomewhere = visibleSomewhere || want
			hiddenSomewhere = hiddenSomewhere || !want
		}
	}
	if !visibleSomewhere || !hiddenSomewhere {
		t.Fatal("the matrix must contain both viewable and hidden cases")
	}
}

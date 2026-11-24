package kanban

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestBoardMetaMatchesBoardMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	if _, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "meta-seed", Description: ""}); err != nil {
		t.Fatal(err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := r.BoardMeta(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(meta.Columns, board.Columns) {
		t.Fatalf("columns differ: meta=%+v board=%+v", meta.Columns, board.Columns)
	}
	if !reflect.DeepEqual(meta.Settings, board.Settings) {
		t.Fatalf("settings differ: meta=%+v board=%+v", meta.Settings, board.Settings)
	}
}

// A saved active project or mobile column that no longer exists must resolve to the same
// fallback in BoardMeta and Board (both go through loadBoardHead).
func TestBoardMetaResolvesMissingIDsLikeBoardMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	const missingID = "999999"
	for _, key := range []string{settingKeyActiveProjectID, settingKeyMobileBoardColumnID} {
		mustExec(t, db, `INSERT INTO board_settings(setting_key, setting_value) VALUES(?, ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, key, missingID)
		key := key
		t.Cleanup(func() {
			mustExec(t, db, `DELETE FROM board_settings WHERE setting_key=?`, key)
		})
	}

	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := r.BoardMeta(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if board.Settings.ActiveProjectID == 999999 || board.Settings.MobileBoardColumnID == 999999 {
		t.Fatalf("missing ids were not resolved to a fallback: %+v", board.Settings)
	}
	if !reflect.DeepEqual(meta.Settings, board.Settings) {
		t.Fatalf("settings differ: meta=%+v board=%+v", meta.Settings, board.Settings)
	}
	if !reflect.DeepEqual(meta.Columns, board.Columns) {
		t.Fatalf("columns differ: meta=%+v board=%+v", meta.Columns, board.Columns)
	}
}

// ActiveProjectID と Columns は、Board と同じ解決結果を返す（保存済みの ID が無いときの代替も含む）。
func TestActiveProjectIDAndColumnsMatchBoardMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	mustExec(t, db, `INSERT INTO board_settings(setting_key, setting_value) VALUES(?, ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, settingKeyActiveProjectID, "999999")
	t.Cleanup(func() {
		mustExec(t, db, `DELETE FROM board_settings WHERE setting_key=?`, settingKeyActiveProjectID)
	})

	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	active, err := r.ActiveProjectID(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if active == 999999 || active != board.Settings.ActiveProjectID {
		t.Fatalf("active=%d board=%d", active, board.Settings.ActiveProjectID)
	}
	columns, err := r.Columns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(columns, board.Columns) {
		t.Fatalf("columns differ: %+v vs %+v", columns, board.Columns)
	}
}

// 一覧（Board / Backlog）は説明を先頭 listDescriptionRunes 文字に切り、ソリューションを返さない。
// 詳細（GetItem）は全文のまま。
func TestListReadsTrimDescriptionAndDropSolutionMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	long := strings.Repeat("あ", listDescriptionRunes+50)
	created, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "trim-seed", Description: long, Solution: "sol"})
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, items []Item) {
		t.Helper()
		for _, it := range items {
			if it.ID != created.ID {
				continue
			}
			if want := strings.Repeat("あ", listDescriptionRunes); it.Description != want {
				t.Fatalf("%s: description runes=%d", name, len([]rune(it.Description)))
			}
			if it.Solution != "" {
				t.Fatalf("%s: solution=%q", name, it.Solution)
			}
			return
		}
		t.Fatalf("%s: item %d missing", name, created.ID)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	check("board", board.Items)
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	check("backlog", backlog)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	ordered, err := listOrderedCards(ctx, tx, created.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	check("ordered", ordered)
	full, err := r.GetItem(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Description != long || full.Solution != "sol" {
		t.Fatalf("detail is trimmed: runes=%d solution=%q", len([]rune(full.Description)), full.Solution)
	}
}

package kanban

import (
	"context"
	"reflect"
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

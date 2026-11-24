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

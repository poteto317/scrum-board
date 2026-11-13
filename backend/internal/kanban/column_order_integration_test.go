package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
)

func TestMySQLColumnReorderAndCreateAppend(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	// 初期3列はすべて position=0 で取得される。ここで新規列 Review を追加しても末尾に並ぶ。
	review, err := r.CreateColumn(ctx, "Review")
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Columns) != 4 || b.Columns[3].ID != review.ID {
		t.Fatalf("expected Review at end before reorder, got %+v", b.Columns)
	}

	// HTTP 経由で Done(3) の前に Review(review.ID) を移動
	h := NewHandler(r)
	payload, _ := json.Marshal(map[string][]int64{"columnIds": {1, 2, review.ID, 3}})
	w := request(h, "PUT", "/api/columns/order", string(payload))
	if w.Code != 200 {
		t.Fatalf("PUT /api/columns/order: %d %s", w.Code, w.Body)
	}

	b, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wantIDs := []int64{1, 2, review.ID, 3}
	for i, want := range wantIDs {
		if b.Columns[i].ID != want || b.Columns[i].Position != i {
			t.Fatalf("column[%d]=%+v, want id=%d pos=%d", i, b.Columns[i], want, i)
		}
	}

	// 並び替え後に新規列を追加しても先頭 (position=0) へ割り込まず末尾へ追加される
	qa, err := r.CreateColumn(ctx, "QA")
	if err != nil {
		t.Fatal(err)
	}
	b, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wantAfterAdd := []int64{1, 2, review.ID, 3, qa.ID}
	if len(b.Columns) != len(wantAfterAdd) {
		t.Fatalf("len=%d want=%d: %+v", len(b.Columns), len(wantAfterAdd), b.Columns)
	}
	for i, want := range wantAfterAdd {
		if b.Columns[i].ID != want {
			t.Fatalf("after create column[%d]=%+v, want id=%d", i, b.Columns[i], want)
		}
	}

	// 列欠落・未知IDは ErrColumnMismatch (409) となり既存 position を変更しない
	for _, bad := range [][]int64{{1, 2, 3}, {1, 2, review.ID, 3, 999}} {
		if _, err := r.ReorderColumns(ctx, bad); !errors.Is(err, ErrColumnMismatch) {
			t.Fatalf("bad=%v: err=%v, want ErrColumnMismatch", bad, err)
		}
	}
	bAfter, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(bAfter.Columns, b.Columns) {
		t.Fatalf("mismatch mutated columns: before=%+v after=%+v", b.Columns, bAfter.Columns)
	}
}

func TestMySQLColumnReorderConcurrency(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	perms := [][]int64{
		{1, 2, 3},
		{3, 2, 1},
		{2, 3, 1},
		{2, 1, 3},
	}

	// フェーズ1: 既存3列のみで20並行 ReorderColumns が全件成功し一意の position (0..2) に収束すること
	const workers = 20
	phase1Errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if _, err := r.ReorderColumns(ctx, perms[idx%len(perms)]); err != nil {
				phase1Errs <- fmt.Errorf("phase1 reorder worker %d: %w", idx, err)
			}
		}(i)
	}
	wg.Wait()
	close(phase1Errs)
	for err := range phase1Errs {
		t.Fatal(err)
	}

	b, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range b.Columns {
		if c.Position != i {
			t.Fatalf("phase1 column[%d]=%+v, want position=%d", i, c, i)
		}
	}

	// フェーズ2: 一意な position 設定後に ReorderColumns と CreateColumn を並行実行してもデッドロック・重複しないこと
	errs := make(chan error, workers+3)
	for i := range workers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, err := r.ReorderColumns(ctx, perms[idx%len(perms)])
			if err != nil && !errors.Is(err, ErrColumnMismatch) {
				errs <- fmt.Errorf("reorder worker %d: %w", idx, err)
			}
		}(i)
	}
	for i := range 3 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, err := r.CreateColumn(ctx, fmt.Sprintf("Extra-%d", idx))
			if err != nil {
				errs <- fmt.Errorf("create worker %d: %w", idx, err)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	b, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Columns) != 6 {
		t.Fatalf("expected 6 columns after concurrent create, got %d: %+v", len(b.Columns), b.Columns)
	}
	seenPos := make(map[int]bool, len(b.Columns))
	for _, c := range b.Columns {
		if seenPos[c.Position] {
			t.Fatalf("duplicate position %d in %+v", c.Position, b.Columns)
		}
		seenPos[c.Position] = true
	}
}

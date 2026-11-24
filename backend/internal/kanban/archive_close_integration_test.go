package kanban

import (
	"context"
	"testing"
	"time"
)

// A Close item is finished like a Done one: it gets a finished-at time on entering the column, and
// is archived after archiveAfterDone (#128).

func mysqlColumnID(t *testing.T, r MySQLRepository, name string) int64 {
	t.Helper()
	ctx := context.Background()
	cols, err := r.Columns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cols {
		if c.Name == name {
			return c.ID
		}
	}
	c, err := r.CreateColumn(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func TestMySQLEnteringAndLeavingCloseStampsAndClearsTheFinishedTime(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID, doneID, todoID := mysqlColumnID(t, r, "Close"), mysqlColumnID(t, r, "Done"), mysqlColumnID(t, r, "Todo")
	created, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "born closed"})
	if err != nil || created.DoneAt == nil {
		t.Fatalf("an item created in Close has a finished time: %+v %v", created.DoneAt, err)
	}
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: todoID, Title: "moves"})
	if err != nil || it.DoneAt != nil {
		t.Fatalf("created in Todo: %+v %v", it.DoneAt, err)
	}
	moved, err := r.UpdateItem(ctx, it.ID, ItemPatch{ColumnID: &closeID})
	if err != nil || moved.DoneAt == nil {
		t.Fatalf("moved into Close: %+v %v", moved.DoneAt, err)
	}
	stamp := *moved.DoneAt
	toDone, err := r.UpdateItem(ctx, it.ID, ItemPatch{ColumnID: &doneID})
	if err != nil || toDone.DoneAt == nil || !toDone.DoneAt.Equal(stamp) {
		t.Fatalf("Close -> Done keeps the time (%v): %+v %v", stamp, toDone.DoneAt, err)
	}
	back, err := r.UpdateItem(ctx, it.ID, ItemPatch{ColumnID: &todoID})
	if err != nil || back.DoneAt != nil {
		t.Fatalf("leaving the finished columns clears the time: %+v %v", back.DoneAt, err)
	}
}

func TestMySQLReorderingIntoCloseStampsTheFinishedTime(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID, todoID := mysqlColumnID(t, r, "Close"), mysqlColumnID(t, r, "Todo")
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: todoID, Title: "dragged to Close"})
	if err != nil {
		t.Fatal(err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var todoIDs, closeIDs []int64
	for _, b := range board.Items {
		switch b.ColumnID {
		case todoID:
			if b.ID != it.ID {
				todoIDs = append(todoIDs, b.ID)
			}
		case closeID:
			closeIDs = append(closeIDs, b.ID)
		}
	}
	closeIDs = append(closeIDs, it.ID)
	items, err := r.ReorderItems(ctx, []ItemColumnOrder{{ColumnID: todoID, ItemIDs: todoIDs}, {ColumnID: closeID, ItemIDs: closeIDs}})
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range items {
		if b.ID == it.ID && b.DoneAt == nil {
			t.Fatalf("an item reordered into Close has a finished time: %+v", b)
		}
	}
}

func TestMySQLArchiveDoneItemsArchivesOldCloseItemsAndRestoresThemToClose(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID := mysqlColumnID(t, r, "Close")
	old, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "old closed"})
	if err != nil {
		t.Fatal(err)
	}
	young, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "young closed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", time.Now().UTC().Add(-archiveAfterDone-time.Minute), old.ID); err != nil {
		t.Fatal(err)
	}
	archived, err := r.ArchiveDoneItems(ctx)
	if err != nil || archived != 1 {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want 1 (the old Close item)", archived, err)
	}
	list, err := r.ListArchivedItems(ctx, old.ProjectID)
	if err != nil || len(list) != 1 || list[0].ID != old.ID {
		t.Fatalf("archived: %+v %v", list, err)
	}
	if got, _ := r.GetItem(ctx, young.ID); got.ArchivedAt != nil {
		t.Fatal("a young Close item must not be archived")
	}
	restored, err := r.RestoreArchivedItem(ctx, old.ID, old.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ColumnID != closeID || restored.ArchivedAt != nil || restored.DoneAt == nil {
		t.Fatalf("an archived Close item goes back to Close with a fresh timer: %+v", restored)
	}
	if elapsed := time.Since(*restored.DoneAt); elapsed < 0 || elapsed > time.Minute {
		t.Fatalf("restore doneAt=%v; want recent", restored.DoneAt)
	}
}

func TestMySQLInitializeArchiveBackfillsCloseItemsToo(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID := mysqlColumnID(t, r, "Close")
	fromHistory, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "closed, with history"})
	if err != nil {
		t.Fatal(err)
	}
	fromUpdatedAt, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "closed, no history"})
	if err != nil {
		t.Fatal(err)
	}
	transitionAt := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	fallbackAt := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	for id, updatedAt := range map[int64]time.Time{fromHistory.ID: transitionAt.Add(time.Hour), fromUpdatedAt.ID: fallbackAt} {
		if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=NULL, updated_at=? WHERE id=?", updatedAt, id); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = insertHistory(ctx, tx, fromHistory.ID, HistoryEvent{
		Kind: "updated", OccurredAt: transitionAt,
		Changes: []HistoryChange{{Field: "status", Before: "Doing", After: "Close"}},
	}, "archive-backfill-close-transition"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = r.InitializeArchive(ctx); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64]time.Time{fromHistory.ID: transitionAt, fromUpdatedAt.ID: fallbackAt} {
		var got time.Time
		if err = db.QueryRowContext(ctx, "SELECT done_at FROM items WHERE id=?", id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if !got.UTC().Equal(want) {
			t.Errorf("item %d done_at=%v, want %v", id, got.UTC(), want)
		}
	}
}

func TestMySQLRestoringACloseItemFromTheTrashKeepsItsFinishedTime(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID := mysqlColumnID(t, r, "Close")
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "closed then deleted"})
	if err != nil || it.DoneAt == nil {
		t.Fatalf("%+v %v", it.DoneAt, err)
	}
	if err = r.DeleteItem(ctx, it.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := r.RestoreItem(ctx, it.ID, it.ProjectID)
	if err != nil || restored.ColumnID != closeID || restored.DoneAt == nil {
		t.Fatalf("restored from the trash into Close keeps the finished time: %+v %v", restored, err)
	}
}

// Moving between Done and Close is not a new finish: the 10-day timer must not restart (#128 review).
func TestMySQLMovingBetweenDoneAndCloseDoesNotRestartTheArchiveTimer(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID, doneID := mysqlColumnID(t, r, "Close"), mysqlColumnID(t, r, "Done")
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: doneID, Title: "done then closed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", time.Now().UTC().Add(-archiveAfterDone-time.Hour), it.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = r.UpdateItem(ctx, it.ID, ItemPatch{ColumnID: &closeID}); err != nil {
		t.Fatal(err)
	}
	archived, err := r.ArchiveDoneItems(ctx)
	if err != nil || archived != 1 {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want 1 (Done->Close keeps the original finish time)", archived, err)
	}
}

// The backfill counts only a move into Done/Close from outside, like the archive check (#128 review).
func TestMySQLInitializeArchiveBackfillIgnoresDoneToCloseMoves(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	closeID := mysqlColumnID(t, r, "Close")
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: closeID, Title: "done, then closed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=NULL, updated_at=? WHERE id=?", time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC), it.ID); err != nil {
		t.Fatal(err)
	}
	enteredAt := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	movedAt := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i, ev := range []HistoryEvent{
		{Kind: "updated", OccurredAt: enteredAt, Changes: []HistoryChange{{Field: "status", Before: "Doing", After: "Done"}}},
		{Kind: "updated", OccurredAt: movedAt, Changes: []HistoryChange{{Field: "status", Before: "Done", After: "Close"}}},
	} {
		if err = insertHistory(ctx, tx, it.ID, ev, "backfill-done-to-close-"+string(rune('a'+i))); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = r.InitializeArchive(ctx); err != nil {
		t.Fatal(err)
	}
	var got time.Time
	if err = db.QueryRowContext(ctx, "SELECT done_at FROM items WHERE id=?", it.ID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if !got.UTC().Equal(enteredAt) {
		t.Fatalf("done_at=%v, want the time it entered Done (%v), not the Done->Close move", got.UTC(), enteredAt)
	}
}

// An archived item whose column is no longer Done/Close goes back to Done.
func TestMySQLRestoringAnArchivedItemFromAnUnfinishedColumnGoesToDone(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	doneID, todoID := mysqlColumnID(t, r, "Done"), mysqlColumnID(t, r, "Todo")
	it, err := r.CreateItem(ctx, ItemInput{ColumnID: doneID, Title: "archived, then its column changed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET archived_at=?, column_id=? WHERE id=?", time.Now().UTC(), todoID, it.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := r.RestoreArchivedItem(ctx, it.ID, it.ProjectID)
	if err != nil || restored.ColumnID != doneID {
		t.Fatalf("restored = %+v, %v; want it in Done", restored, err)
	}
}

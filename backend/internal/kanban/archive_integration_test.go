package kanban

import (
	"bytes"
	"context"
	"errors"
	"strconv"
	"testing"
	"time"
)

func TestMySQLArchiveDoneItemsIsIdempotentAndRestoreResetsDoneTime(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	repo := MySQLRepository{DB: db}
	old, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "old Done item"})
	if err != nil {
		t.Fatal(err)
	}
	blobs := NewMemoryBlobStorage()
	attachment, err := repo.CreateAttachment(ctx, blobs, old.ID, "description", nil, "image.png", "image/png", 0, bytes.NewReader(pngBytes()), nil)
	if err != nil {
		t.Fatal(err)
	}
	young, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "young Done item"})
	if err != nil {
		t.Fatal(err)
	}
	staleDoneAt, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "stale Done timestamp"})
	if err != nil {
		t.Fatal(err)
	}
	unknownDoneAt, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "unknown Done timestamp"})
	if err != nil {
		t.Fatal(err)
	}
	oldDoneAt := time.Now().UTC().Add(-archiveAfterDone - time.Minute)
	youngDoneAt := time.Now().UTC().Add(-archiveAfterDone + time.Minute)
	recentTransitionAt := time.Now().UTC().Add(-time.Hour)
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", oldDoneAt, old.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", youngDoneAt, young.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", oldDoneAt, staleDoneAt.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=NULL WHERE id=?", unknownDoneAt.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = insertHistory(ctx, tx, staleDoneAt.ID, HistoryEvent{
		Kind: "updated", OccurredAt: recentTransitionAt,
		Changes: []HistoryChange{{Field: "status", Before: "Doing", After: "Done"}},
	}, "archive-recent-done-transition"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}

	archived, err := repo.ArchiveDoneItems(ctx)
	if err != nil || archived != 1 {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want 1, nil", archived, err)
	}
	archivedItems, err := repo.ListArchivedItems(ctx, old.ProjectID)
	if err != nil || len(archivedItems) != 1 || archivedItems[0].ID != old.ID {
		t.Fatalf("ListArchivedItems() = %+v, %v; want only item %d", archivedItems, err, old.ID)
	}
	for _, id := range []int64{staleDoneAt.ID, unknownDoneAt.ID, young.ID} {
		got, getErr := repo.GetItem(ctx, id)
		if getErr != nil {
			t.Fatalf("GetItem(%d): %v", id, getErr)
		}
		if got.ArchivedAt != nil {
			t.Fatalf("item %d should not be archived (stale history / unknown / young)", id)
		}
	}
	if archivedItems[0].DoneAt == nil || !archivedItems[0].DoneAt.Equal(oldDoneAt) || archivedItems[0].ArchivedAt == nil {
		t.Fatalf("archived timestamps = doneAt %v, archivedAt %v", archivedItems[0].DoneAt, archivedItems[0].ArchivedAt)
	}
	if archived, err = repo.ArchiveDoneItems(ctx); err != nil || archived != 0 {
		t.Fatalf("second ArchiveDoneItems() = %d, %v; want 0, nil", archived, err)
	}
	if _, err = repo.CreateComment(ctx, old.ID, "user", "new note", 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateComment on archived item = %v; want ErrNotFound", err)
	}
	if _, err = repo.ReplaceItemCommandTemplates(ctx, old.ID, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ReplaceItemCommandTemplates on archived item = %v; want ErrNotFound", err)
	}
	if err = repo.AppendAITurn(ctx, old.ID, "question", "answer", 1, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AppendAITurn on archived item = %v; want ErrNotFound", err)
	}
	if err = repo.ClearAIMessages(ctx, old.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ClearAIMessages on archived item = %v; want ErrNotFound", err)
	}
	if _, err = repo.CreateAttachment(ctx, blobs, old.ID, "description", nil, "image.png", "image/png", 0, bytes.NewReader(pngBytes()), nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateAttachment on archived item = %v; want ErrNotFound", err)
	}
	if err = repo.DeleteAttachment(ctx, blobs, old.ID, attachment.ID, old.Number); !errors.Is(err, ErrNotFound) {
		t.Fatalf("DeleteAttachment on archived item = %v; want ErrNotFound", err)
	}

	restored, err := repo.RestoreArchivedItem(ctx, old.ID, old.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ArchivedAt != nil || restored.DoneAt == nil || restored.ColumnID != 3 {
		t.Fatalf("restored item = %+v; want active Done item with reset timer", restored)
	}
	if elapsed := time.Since(*restored.DoneAt); elapsed < 0 || elapsed > time.Minute {
		t.Fatalf("restore doneAt=%v; want recent UTC timestamp", restored.DoneAt)
	}
	if _, err = repo.RestoreArchivedItem(ctx, old.ID, old.ProjectID+100); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore with another project = %v; want ErrNotFound", err)
	}
}

func TestMySQLInitializeArchiveBackfillsFromDoneTransitionAndUpdatedAt(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	repo := MySQLRepository{DB: db}
	fromHistory, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "history timestamp"})
	if err != nil {
		t.Fatal(err)
	}
	fromUpdatedAt, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "updated timestamp"})
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
		Changes: []HistoryChange{{Field: "status", Before: "Doing", After: "Done"}},
	}, "archive-backfill-transition"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}

	if err = repo.InitializeArchive(ctx); err != nil {
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

	// A repeated migration must preserve an already backfilled timestamp.
	if _, err = db.ExecContext(ctx, "UPDATE items SET updated_at=? WHERE id=?", fallbackAt.Add(time.Hour), fromUpdatedAt.ID); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeArchive(ctx); err != nil {
		t.Fatal(err)
	}
	var persisted time.Time
	if err = db.QueryRowContext(ctx, "SELECT done_at FROM items WHERE id=?", fromUpdatedAt.ID).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if !persisted.UTC().Equal(fallbackAt) {
		t.Fatalf("rerun changed done_at to %v; want %v", persisted.UTC(), fallbackAt)
	}
}

func TestMySQLArchiveDoneItemsBatchesOver100(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	repo := MySQLRepository{DB: db}
	cutoff := time.Now().UTC().Add(-archiveAfterDone - time.Minute)
	const n = archiveBatchSize + 1
	ids := make([]int64, 0, n)
	for i := 0; i < n; i++ {
		item, err := repo.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "batch-" + strconv.Itoa(i)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.ExecContext(ctx, "UPDATE items SET done_at=? WHERE id=?", cutoff, item.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, item.ID)
	}
	archived, err := repo.ArchiveDoneItems(ctx)
	if err != nil || archived != n {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want %d", archived, err, n)
	}
	listed, err := repo.ListArchivedItems(ctx, 1)
	if err != nil || len(listed) != n {
		t.Fatalf("ListArchivedItems len=%d err=%v; want %d", len(listed), err, n)
	}
	if archived, err = repo.ArchiveDoneItems(ctx); err != nil || archived != 0 {
		t.Fatalf("second ArchiveDoneItems() = %d, %v; want 0", archived, err)
	}
	_ = ids
}

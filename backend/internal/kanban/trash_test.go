package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestTrashAPIMemory(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	_ = request(h, "POST", "/api/items", `{"title":"bin me","columnId":2}`)
	if w := request(h, "DELETE", "/api/items/1", ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	w := request(h, "GET", "/api/trash?projectId=1", "")
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	var listed struct {
		Items []TrashItem `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listed)
	if len(listed.Items) != 1 || listed.Items[0].Number != 1 || listed.Items[0].Title != "bin me" || listed.Items[0].DeletedAt.IsZero() {
		t.Fatalf("list body: %+v", listed.Items)
	}

	if w = request(h, "POST", "/api/items/1/restore?projectId=1", ""); w.Code != 200 {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	var restored Item
	_ = json.Unmarshal(w.Body.Bytes(), &restored)
	if restored.DeletedAt != nil || restored.ColumnID != 2 {
		t.Fatalf("restore fields: %+v", restored)
	}
	if w = request(h, "POST", "/api/items/1/restore?projectId=1", ""); w.Code != 404 {
		t.Fatalf("restore living: %d", w.Code)
	}
	if w = request(h, "DELETE", "/api/trash/1?projectId=1", ""); w.Code != 404 {
		t.Fatalf("hard living: %d", w.Code)
	}

	_ = request(h, "DELETE", "/api/items/1", "")
	if w = request(h, "DELETE", "/api/trash/1?projectId=1", ""); w.Code != 204 {
		t.Fatalf("hard trash: %d", w.Code)
	}
	if _, ok := repo.cards[1]; ok {
		t.Fatal("hard delete left card")
	}
	if w = request(h, "DELETE", "/api/trash/999?projectId=1", ""); w.Code != 404 {
		t.Fatalf("hard missing: %d", w.Code)
	}
}

func TestTrashRestoreTodoWhenColumnGoneMemory(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 99, ProjectID: 1, Title: "x", DeletedAt: &now}
	h := NewHandler(repo)
	w := request(h, "POST", "/api/items/1/restore?projectId=1", "")
	if w.Code != 200 {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	var restored Item
	_ = json.Unmarshal(w.Body.Bytes(), &restored)
	if restored.ColumnID != 1 {
		t.Fatalf("want Todo, got %+v", restored)
	}
}

func TestTrashOpportunisticPurgeScopedMemory(t *testing.T) {
	repo := fresh()
	repo.projects = append(repo.projects, Project{ID: 2, Name: "Other", Position: 1})
	old := time.Now().UTC().Add(-trashRetention - time.Hour)
	edge := time.Now().UTC().Add(-trashRetention) // exactly 30d → purge
	freshDel := time.Now().UTC().Add(-time.Hour)
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "old-p1", DeletedAt: &old}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, ProjectID: 1, Title: "edge-p1", DeletedAt: &edge}
	repo.cards[3] = Item{ID: 3, Number: 3, ColumnID: 1, ProjectID: 1, Title: "fresh-p1", DeletedAt: &freshDel}
	repo.cards[4] = Item{ID: 4, Number: 1, ColumnID: 1, ProjectID: 2, Title: "old-p2", DeletedAt: &old}

	h := NewHandler(repo)
	w := request(h, "GET", "/api/trash?projectId=1", "")
	var listed struct {
		Items []TrashItem `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listed)
	if w.Code != 200 || len(listed.Items) != 1 || listed.Items[0].ID != 3 {
		t.Fatalf("opportunistic p1: %d %+v cards=%v", w.Code, listed.Items, keys(repo.cards))
	}
	if _, ok := repo.cards[4]; !ok {
		t.Fatal("other project expired must remain after GET trash p1")
	}

	w = request(h, "POST", "/api/trash/purge", "")
	var purged struct {
		Purged int64 `json:"purged"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &purged)
	if w.Code != 200 || purged.Purged != 1 {
		t.Fatalf("global purge: %d %+v cards=%v", w.Code, purged, keys(repo.cards))
	}
	if _, ok := repo.cards[4]; ok {
		t.Fatal("global purge should remove other project expired")
	}
	if _, ok := repo.cards[3]; !ok {
		t.Fatal("fresh soft-delete must survive purge")
	}
}

func keys(m map[int64]Item) []int64 {
	out := make([]int64, 0, len(m))
	for id := range m {
		out = append(out, id)
	}
	return out
}

func TestTrashAPIMySQL(t *testing.T) {
	r, a, _ := newOrderedBoard(t)
	ctx := context.Background()
	other, err := r.CreateProject(ctx, "Other")
	if err != nil {
		t.Fatal(err)
	}
	otherCard, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "other", ProjectID: &other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteItem(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteItem(ctx, otherCard.ID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, r.DB, `UPDATE items SET deleted_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 31 DAY) WHERE id=?`, otherCard.ID)

	listed, err := r.ListTrash(ctx, a.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != a.ID {
		t.Fatalf("list after opportunistic: %+v", listed)
	}
	var otherGone int
	if err = r.DB.QueryRow(`SELECT COUNT(*) FROM items WHERE id=?`, otherCard.ID).Scan(&otherGone); err != nil || otherGone != 1 {
		t.Fatalf("opportunistic must not purge other project: %d %v", otherGone, err)
	}

	restored, err := r.RestoreItem(ctx, a.ID, a.ProjectID)
	if err != nil || restored.DeletedAt != nil {
		t.Fatalf("restore: %+v %v", restored, err)
	}
	if _, err = r.RestoreItem(ctx, a.ID, a.ProjectID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore living: %v", err)
	}
	if err = r.DeleteItem(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if err = r.HardDeleteTrashItem(ctx, a.ID, a.ProjectID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = r.DB.QueryRow(`SELECT COUNT(*) FROM items WHERE id=?`, a.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("hard trash: %d %v", n, err)
	}
	if err = r.HardDeleteTrashItem(ctx, a.ID, a.ProjectID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("hard missing: %v", err)
	}

	mustExec(t, r.DB, `UPDATE items SET deleted_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 DAY) WHERE id=?`, otherCard.ID)
	purged, err := r.PurgeExpiredTrash(ctx)
	if err != nil || purged != 1 {
		t.Fatalf("purge boundary: purged=%d err=%v", purged, err)
	}
}

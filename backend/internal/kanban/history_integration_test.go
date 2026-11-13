package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMySQLHistory(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	before, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	after, _ := r.GetCard(ctx, 1)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("migration mutated card")
	}
	for range 2 {
		if err = r.InitializeHistory(ctx); err != nil {
			t.Fatal(err)
		}
	}
	page, err := r.History(ctx, 1, 0)
	if err != nil || len(page.Events) != 1 || page.Events[0].Kind != "baseline" {
		t.Fatalf("baseline: %+v %v", page, err)
	}
	c, err := r.CreateCard(ctx, CardInput{Title: "new", Description: "body", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err = r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	page, err = r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 1 || page.Events[0].Kind != "created" {
		t.Fatalf("created restart: %+v %v", page, err)
	}
	title, desc, url, col := "changed", "changed body", "https://github.com/a/b/pull/1", int64(2)
	if _, err = r.UpdateCard(ctx, c.ID, CardPatch{Title: &title, Description: &desc, PRURL: &url, ColumnID: &col}); err != nil {
		t.Fatal(err)
	}
	page, err = r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 2 || len(page.Events[0].Changes) != 4 {
		t.Fatalf("diff: %+v %v", page, err)
	}
	if page.Events[0].Changes[2].Before != "Todo" || page.Events[0].Changes[2].After != "Doing" {
		t.Fatal(page.Events[0])
	}
	if _, err = r.UpdateCard(ctx, c.ID, CardPatch{Title: &title}); err != nil {
		t.Fatal(err)
	}
	page, _ = r.History(ctx, c.Number, 0)
	if len(page.Events) != 2 {
		t.Fatal("no-op added history")
	}
	// Breaking only the history table must roll back the preceding card UPDATE.
	saved, _ := r.GetCard(ctx, c.ID)
	if _, err = db.Exec("RENAME TABLE card_history TO hidden_history"); err != nil {
		t.Fatal(err)
	}
	var nextBefore int64
	if err = db.QueryRow("SELECT next_number FROM card_number_sequence WHERE singleton=1").Scan(&nextBefore); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateCard(ctx, CardInput{Title: "must not exist", ColumnID: 1}); err == nil {
		t.Fatal("create must roll back when history fails")
	}
	var nextAfter int64
	if err = db.QueryRow("SELECT next_number FROM card_number_sequence WHERE singleton=1").Scan(&nextAfter); err != nil || nextAfter != nextBefore {
		t.Fatal("failed history consumed number", err)
	}
	bad := "must rollback"
	if _, err = r.UpdateCard(ctx, c.ID, CardPatch{Title: &bad}); err == nil {
		t.Fatal("history failure must reject update")
	}
	if _, err = db.Exec("RENAME TABLE hidden_history TO card_history"); err != nil {
		t.Fatal(err)
	}
	current, _ := r.GetCard(ctx, c.ID)
	if !reflect.DeepEqual(saved, current) {
		t.Fatal("partial update")
	}
	record := HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: "test-import", OccurredAt: c.CreatedAt.Add(-time.Hour), Note: "known timestamp only", Changes: []HistoryChange{}}
	for range 2 {
		if err = r.ImportHistory(ctx, []HistoricalRecord{record}); err != nil {
			t.Fatal(err)
		}
	}
	page, _ = r.History(ctx, c.Number, 0)
	if len(page.Events) != 3 || page.Events[2].Kind != "restored" {
		t.Fatalf("import/order: %+v", page)
	}
	original, _ := r.GetCard(ctx, c.ID)
	if !reflect.DeepEqual(current, original) {
		t.Fatal("import modified card")
	}
	invalid := record
	invalid.Key = "second"
	invalid.CardID++
	record.Key = "rolled-back"
	if err = r.ImportHistory(ctx, []HistoricalRecord{record, invalid}); err == nil {
		t.Fatal("identity mismatch accepted")
	}
	page, _ = r.History(ctx, c.Number, 0)
	if len(page.Events) != 3 {
		t.Fatal("partial import")
	}
	// Include enough tied timestamps for a full page and a tail.
	records := []HistoricalRecord{}
	for i := 0; i < 55; i++ {
		v := record
		v.Key = "page-" + strings.Repeat("x", i+1)
		records = append(records, v)
	}
	if err = r.ImportHistory(ctx, records); err != nil {
		t.Fatal(err)
	}
	page, err = r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 50 || page.NextBefore == 0 {
		t.Fatalf("first page: %+v %v", page, err)
	}
	tail, err := r.History(ctx, c.Number, page.NextBefore)
	if err != nil || len(tail.Events) != 8 || tail.NextBefore != 0 {
		t.Fatalf("tail: %+v %v", tail, err)
	}
	seen := map[int64]bool{}
	for _, event := range append(page.Events, tail.Events...) {
		if seen[event.ID] {
			t.Fatal("duplicate cursor row")
		}
		seen[event.ID] = true
	}
	if _, err = r.History(ctx, 1, page.Events[0].ID); err == nil {
		t.Fatal("cross-card cursor accepted")
	}
	h := NewHandler(r)
	for _, path := range []string{"/api/cards/by-number/0/history", "/api/cards/by-number/1/history?before=-1", "/api/cards/by-number/1/history?before=x"} {
		if w := request(h, "GET", path, ""); w.Code != 400 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	if w := request(h, "GET", "/api/cards/by-number/9999/history", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	w := request(h, "GET", "/api/cards/by-number/1/history", "")
	if w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body)
	}
	var decoded HistoryPage
	if err = json.Unmarshal(w.Body.Bytes(), &decoded); err != nil || len(decoded.Events) != 1 {
		t.Fatal(decoded, err)
	}
}

func TestMySQLHistoryParallelAndConflictingImport(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	title, desc := "parallel title", "parallel description"
	errs := make(chan error, 2)
	go func() { _, e := r.UpdateCard(ctx, 1, CardPatch{Title: &title}); errs <- e }()
	go func() { _, e := r.UpdateCard(ctx, 1, CardPatch{Description: &desc}); errs <- e }()
	for range 2 {
		if e := <-errs; e != nil {
			t.Fatal(e)
		}
	}
	c, err := r.GetCard(ctx, 1)
	if err != nil || c.Title != title || c.Description != desc {
		t.Fatal(c, err)
	}
	page, err := r.History(ctx, 1, 0)
	if err != nil || len(page.Events) != 3 {
		t.Fatal(page, err)
	}
	if len(page.Events[0].Changes) != 1 || len(page.Events[1].Changes) != 1 || page.Events[0].Changes[0].Field == page.Events[1].Changes[0].Field {
		t.Fatal("parallel history lost independent diff", page)
	}
	v := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: c.CreatedAt, Key: "same-key", OccurredAt: c.CreatedAt, Note: "original"}
	if err = r.ImportHistory(ctx, []HistoricalRecord{v}); err != nil {
		t.Fatal(err)
	}
	v.Note = "conflicting content"
	if err = r.ImportHistory(ctx, []HistoricalRecord{v}); err == nil {
		t.Fatal("existing key content was silently ignored")
	}
	if err = r.DeleteCard(ctx, 1); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM card_history WHERE card_id=1").Scan(&count); err != nil || count != 0 {
		t.Fatal("history cascade", count, err)
	}
}

func TestMySQLImportNanosecondIdempotency(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	c, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	v := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: c.CreatedAt, Key: "nano", OccurredAt: c.CreatedAt.Add(789 * time.Nanosecond), Note: "nanosecond precision source"}
	for range 2 {
		if err = r.ImportHistory(ctx, []HistoricalRecord{v}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMySQLConcurrentImportRejectsConflict(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	mustInit(t, r)
	first, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.CreateCard(ctx, CardInput{Title: "second", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	var id int64
	if err = blocker.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", second.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	a := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: first.CreatedAt, Key: "batch-a-first", OccurredAt: first.CreatedAt, Note: "A"}
	b := HistoricalRecord{Number: second.Number, CardID: second.ID, CreatedAt: second.CreatedAt, Key: "conflict", OccurredAt: second.CreatedAt, Note: "A expects this"}
	result := make(chan error, 1)
	go func() { result <- r.ImportHistory(ctx, []HistoricalRecord{a, b}) }()
	// Observe A's first INSERT without committing it, so A has an old read view before B commits.
	probe, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadUncommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback()
	ready := false
	for i := 0; i < 200; i++ {
		var count int
		if err = probe.QueryRowContext(ctx, "SELECT COUNT(*) FROM card_history WHERE card_id=1 AND event_key='batch-a-first'").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			ready = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !ready {
		t.Fatal("import A did not reach the synchronization point")
	}
	if err = insertHistory(ctx, blocker, second.ID, HistoryEvent{Kind: "restored", OccurredAt: second.CreatedAt, Changes: []HistoryChange{}, Note: "B committed different content"}, "conflict"); err != nil {
		t.Fatal(err)
	}
	if err = blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-result; err == nil {
		t.Fatal("concurrent key conflict was silently ignored")
	}
	var count int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM card_history WHERE event_key='batch-a-first'").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial batch committed", count, err)
	}
}

func TestMySQLImportAndDeleteConcurrent(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	mustInit(t, r)
	for round := 0; round < 8; round++ {
		cards := []Card{}
		for i := 0; i < 30; i++ {
			c, e := r.CreateCard(ctx, CardInput{Title: "concurrent deletion", ColumnID: 1})
			if e != nil {
				t.Fatal(e)
			}
			cards = append(cards, c)
		}
		start := make(chan struct{})
		results := make(chan error, 2*len(cards))
		for _, c := range cards {
			go func(c Card) {
				<-start
				results <- r.ImportHistory(ctx, []HistoricalRecord{{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: "delete-race", OccurredAt: c.CreatedAt, Note: "verified import"}})
			}(c)
			go func(c Card) { <-start; results <- r.DeleteCard(ctx, c.ID) }(c)
		}
		close(start)
		for range 2 * len(cards) {
			if err := <-results; err != nil && !errors.Is(err, ErrNotFound) {
				t.Errorf("import/delete race: %v", err)
			}
		}
	}
}

func TestMySQLImportWaitsForCardBeforeNumberOnDelete(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	mustInit(t, r)
	first, _ := r.GetCard(ctx, 1)
	second, err := r.CreateCard(ctx, CardInput{Title: "delete target", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	var id int64
	if err = blocker.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", second.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	a := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: first.CreatedAt, Key: "before-delete", OccurredAt: first.CreatedAt, Note: "first"}
	b := HistoricalRecord{Number: second.Number, CardID: second.ID, CreatedAt: second.CreatedAt, Key: "will-delete", OccurredAt: second.CreatedAt, Note: "second"}
	result := make(chan error, 1)
	go func() { result <- r.ImportHistory(ctx, []HistoricalRecord{a, b}) }()
	probe, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadUncommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback()
	ready := false
	for i := 0; i < 200; i++ {
		var count int
		if err = probe.QueryRowContext(ctx, "SELECT COUNT(*) FROM card_history WHERE event_key='before-delete'").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			ready = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !ready {
		t.Fatal("import did not reach the second card")
	}
	// The second card remains locked while the importer reaches its next statement.
	time.Sleep(50 * time.Millisecond)
	if _, err = blocker.ExecContext(ctx, "DELETE FROM cards WHERE id=?", second.ID); err != nil {
		t.Fatal("delete deadlocked with import", err)
	}
	if err = blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = <-result; !errors.Is(err, ErrNotFound) {
		t.Fatal("expected removed card, not deadlock", err)
	}
}

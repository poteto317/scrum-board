package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
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
	baseline := page.Events[0]
	var status string
	if err = db.QueryRow("SELECT name FROM board_columns WHERE id=?", after.ColumnID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	wantBaseline := []HistoryChange{
		{Field: "title", After: after.Title},
		{Field: "description", After: after.Description},
		{Field: "status", After: status},
		{Field: "prUrls", After: prURLsJSON(after.PRURLs)},
		{Field: "assignee", After: after.Assignee},
	}
	if !reflect.DeepEqual(baseline.Changes, wantBaseline) || baseline.Note == "" || baseline.OccurredAt.Year() < 2020 || baseline.EvidenceURL != "" {
		t.Fatalf("baseline content: %+v want %+v", baseline, wantBaseline)
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
	urls := []string{url}
	if _, err = r.UpdateCard(ctx, c.ID, CardPatch{Title: &title, Description: &desc, PRURLs: &urls, ColumnID: &col}); err != nil {
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
	// Never leave the renamed table behind: it keeps a foreign key to cards and would break every later reset.
	t.Cleanup(func() { _, _ = db.Exec("RENAME TABLE hidden_history TO card_history") })
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

func TestMySQLImportRejectsFutureOccurredAtWithoutWriting(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	c, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := r.History(ctx, c.Number, 0)
	ok := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: c.CreatedAt, Key: "valid-in-bad-batch", OccurredAt: c.CreatedAt, Note: "valid source"}
	typo := ok
	typo.Key = "typo-year"
	typo.OccurredAt = time.Date(2062, 11, 12, 0, 0, 0, 0, time.UTC)
	if err = r.ImportHistory(ctx, []HistoricalRecord{ok, typo}); err == nil {
		t.Fatal("future occurredAt accepted")
	}
	after, _ := r.History(ctx, c.Number, 0)
	if len(after.Events) != len(before.Events) {
		t.Fatalf("batch with a future record wrote events: %d -> %d", len(before.Events), len(after.Events))
	}
}

func TestMySQLImportWorksWithInterpolatedParams(t *testing.T) {
	db := mysqlTestDB(t, "")
	mustInit(t, MySQLRepository{DB: db})
	c, err := MySQLRepository{DB: db}.GetCard(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := mysql.ParseDSN(os.Getenv("KANBAN_TEST_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.ParseTime, cfg.Loc, cfg.InterpolateParams = true, time.UTC, true
	plain, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { plain.Close() })
	v := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: c.CreatedAt, Key: "interpolated", OccurredAt: c.CreatedAt, Changes: []HistoryChange{{Field: "status", Before: "Todo", After: "Done"}}, Note: "client-side parameter interpolation"}
	if err = (MySQLRepository{DB: plain}).ImportHistory(context.Background(), []HistoricalRecord{v}); err != nil {
		t.Fatal(err)
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

func newHistoryCard(t *testing.T, r MySQLRepository) Card {
	t.Helper()
	mustInit(t, r)
	if err := r.InitializeHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	c, err := r.CreateCard(context.Background(), CardInput{Title: "history subject", Description: "body", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestMySQLHistoryRecordsEachFieldWithBeforeAndAfter(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	c := newHistoryCard(t, r)
	title, desc, url, col := "new title", "new body", "https://github.com/a/b/pull/9", int64(2)
	urls := []string{url}
	if _, err := r.UpdateCard(ctx, c.ID, CardPatch{Title: &title, Description: &desc, PRURLs: &urls, ColumnID: &col}); err != nil {
		t.Fatal(err)
	}
	page, err := r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 2 {
		t.Fatal(page, err)
	}
	want := []HistoryChange{
		{Field: "title", Before: "history subject", After: "new title"},
		{Field: "description", Before: "body", After: "new body"},
		{Field: "status", Before: "Todo", After: "Doing"},
		{Field: "prUrls", Before: "[]", After: prURLsJSON(urls)},
	}
	if !reflect.DeepEqual(page.Events[0].Changes, want) || page.Events[0].Kind != "updated" {
		t.Fatalf("changes: %+v", page.Events[0])
	}
	created := page.Events[1]
	if created.Kind != "created" || len(created.Changes) != 5 || created.Changes[0].After != "history subject" || created.Changes[1].After != "body" || created.Changes[2].After != "Todo" {
		t.Fatalf("created event: %+v", created)
	}
}

func TestMySQLImportRejectsEachIdentityMismatchWithoutWriting(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	c := newHistoryCard(t, r)
	base := HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: "identity", OccurredAt: c.CreatedAt, Note: "source"}
	for name, mutate := range map[string]func(*HistoricalRecord){
		"number":    func(v *HistoricalRecord) { v.Number++ },
		"createdAt": func(v *HistoricalRecord) { v.CreatedAt = v.CreatedAt.Add(time.Second) },
	} {
		v := base
		mutate(&v)
		if err := r.ImportHistory(ctx, []HistoricalRecord{v}); err == nil {
			t.Fatalf("%s mismatch accepted", name)
		}
	}
	page, _ := r.History(ctx, c.Number, 0)
	if len(page.Events) != 1 {
		t.Fatalf("mismatched import wrote events: %+v", page)
	}
}

func TestMySQLImportKeyConflictChecksEveryStoredField(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	c := newHistoryCard(t, r)
	base := HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: "same", OccurredAt: c.CreatedAt, Note: "original", EvidenceURL: "https://github.com/a/b/pull/1", Changes: []HistoryChange{{Field: "status", Before: "Todo", After: "Done"}}}
	if err := r.ImportHistory(ctx, []HistoricalRecord{base}); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*HistoricalRecord){
		"occurredAt": func(v *HistoricalRecord) { v.OccurredAt = v.OccurredAt.Add(time.Second) },
		"evidence":   func(v *HistoricalRecord) { v.EvidenceURL = "https://github.com/a/b/pull/2" },
		"note":       func(v *HistoricalRecord) { v.Note = "other" },
		"changes": func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "status", Before: "Todo", After: "Doing"}}
		},
	} {
		v := base
		mutate(&v)
		if err := r.ImportHistory(ctx, []HistoricalRecord{v}); err == nil {
			t.Fatalf("conflicting %s was silently accepted", name)
		}
	}
	// A key owned by a non-restored event (the baseline) is never an idempotent re-run, even when every other field matches.
	first, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	var baseline HistoricalRecord
	var payload []byte
	baseline.Number, baseline.CardID, baseline.CreatedAt, baseline.Key = first.Number, first.ID, first.CreatedAt, "baseline-v1"
	if err = r.DB.QueryRow("SELECT occurred_at,changes,note,evidence_url FROM card_history WHERE card_id=1 AND event_key='baseline-v1'").Scan(&baseline.OccurredAt, &payload, &baseline.Note, &baseline.EvidenceURL); err != nil {
		t.Fatal("seed card must have a baseline event:", err)
	}
	if err = json.Unmarshal(payload, &baseline.Changes); err != nil {
		t.Fatal(err)
	}
	if err = r.ImportHistory(ctx, []HistoricalRecord{baseline}); err == nil {
		t.Fatal("import reused a baseline key")
	}
	if err := r.ImportHistory(ctx, []HistoricalRecord{base}); err != nil {
		t.Fatalf("identical re-run rejected: %v", err)
	}
}

func TestMySQLHistoryPageBoundaries(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	c := newHistoryCard(t, r)
	records := func(n int, at time.Time, prefix string) []HistoricalRecord {
		out := []HistoricalRecord{}
		for i := 0; i < n; i++ {
			out = append(out, HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: fmt.Sprintf("%s-%d", prefix, i), OccurredAt: at, Note: "source"})
		}
		return out
	}
	tied := c.CreatedAt.Add(-time.Hour)
	// created + 49 restored = exactly 50 events: one full page, no next cursor.
	if err := r.ImportHistory(ctx, records(49, tied, "tied")); err != nil {
		t.Fatal(err)
	}
	page, err := r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 50 || page.NextBefore != 0 {
		t.Fatalf("exactly one page: len=%d next=%d err=%v", len(page.Events), page.NextBefore, err)
	}
	// An older event inserted last has the largest id but sorts last: the cursor must still reach it.
	if err = r.ImportHistory(ctx, records(1, c.CreatedAt.Add(-2*time.Hour), "older")); err != nil {
		t.Fatal(err)
	}
	page, err = r.History(ctx, c.Number, 0)
	if err != nil || len(page.Events) != 50 || page.NextBefore == 0 {
		t.Fatalf("first page of 51: len=%d next=%d err=%v", len(page.Events), page.NextBefore, err)
	}
	tail, err := r.History(ctx, c.Number, page.NextBefore)
	if err != nil || len(tail.Events) != 1 || tail.NextBefore != 0 || tail.Events[0].OccurredAt.After(tied) {
		t.Fatalf("tail must hold the older event: %+v %v", tail, err)
	}
}

func TestMySQLConcurrentImportsInOppositeOrderDoNotDeadlock(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	a := newHistoryCard(t, r)
	b, err := r.CreateCard(ctx, CardInput{Title: "second", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	record := func(c Card, key string) HistoricalRecord {
		return HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: key, OccurredAt: c.CreatedAt, Note: "source"}
	}
	for round := 0; round < 20; round++ {
		key := fmt.Sprintf("round-%d", round)
		results := make(chan error, 2)
		start := make(chan struct{})
		go func() { <-start; results <- r.ImportHistory(ctx, []HistoricalRecord{record(a, key), record(b, key)}) }()
		go func() { <-start; results <- r.ImportHistory(ctx, []HistoricalRecord{record(b, key), record(a, key)}) }()
		close(start)
		for range 2 {
			if err = <-results; err != nil {
				t.Fatalf("round %d: %v", round, err)
			}
		}
	}
}

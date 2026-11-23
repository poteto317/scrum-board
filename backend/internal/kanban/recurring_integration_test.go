package kanban

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRunRecurringMySQLCreatesAndSkips(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	other, err := r.CreateProject(ctx, "other-recurring")
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-48 * time.Hour)
	due, err := r.CreateRecurringRule(ctx, other.ID, RecurringRuleInput{
		Name: "due", Title: "auto-title", Description: "auto-desc",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE recurring_rules SET created_at=? WHERE id=?`, past, due.ID)

	future, err := r.CreateRecurringRule(ctx, 1, RecurringRuleInput{
		Name: "future", Title: "future-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = future

	badCol, err := r.CreateRecurringRule(ctx, 1, RecurringRuleInput{
		Name: "badcol", Title: "badcol-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE recurring_rules SET column_id=99999, created_at=? WHERE id=?`, past, badCol.ID)

	created, skipped, failed, err := r.RunRecurring(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if created != 1 || skipped < 1 || failed != 1 {
		t.Fatalf("created=%d skipped=%d failed=%d", created, skipped, failed)
	}

	items, err := r.BoardForProject(ctx, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	var found *Item
	for i := range items.Items {
		if items.Items[i].Title == "auto-title" {
			found = &items.Items[i]
			break
		}
	}
	if found == nil {
		t.Fatal("auto item missing")
	}
	if found.ProjectID != other.ID || found.Description != "auto-desc" || found.CreatedByUserID != nil || found.DueAt != nil {
		t.Fatalf("item=%+v", found)
	}

	reloaded, err := loadRecurringRule(ctx, db, due.ID)
	if err != nil || reloaded.LastFiredAt == nil {
		t.Fatalf("lastFiredAt not set: %+v err=%v", reloaded, err)
	}
	badReloaded, err := loadRecurringRule(ctx, db, badCol.ID)
	if err != nil || badReloaded.LastFiredAt != nil || !badReloaded.Enabled {
		t.Fatalf("failed rule state: %+v err=%v", badReloaded, err)
	}

	c2, s2, f2, err := r.RunRecurring(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c2 != 0 || f2 != 1 {
		t.Fatalf("second run created=%d skipped=%d failed=%d", c2, s2, f2)
	}
}

func TestRunRecurringMySQLExpandsPlaceholders(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	past := time.Now().UTC().Add(-48 * time.Hour)
	rule, err := r.CreateRecurringRule(ctx, 1, RecurringRuleInput{
		Name: "dyn", Title: "週次 {{weekStart}}", Description: "日 {{date}}",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE recurring_rules SET created_at=? WHERE id=?`, past, rule.ID)

	before := time.Now().UTC()
	created, _, failed, err := r.RunRecurring(ctx)
	after := time.Now().UTC()
	if err != nil || created != 1 || failed != 0 {
		t.Fatalf("created=%d failed=%d err=%v", created, failed, err)
	}
	wantTitle, wantDesc, wantErr := materializeRecurringFire(rule, before)
	if wantErr != nil {
		t.Fatal(wantErr)
	}
	// Run uses its own now; date tokens equal if same UTC calendar day as before/after window.
	altTitle, altDesc, _ := materializeRecurringFire(rule, after)
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found *Item
	for i := range board.Items {
		if strings.HasPrefix(board.Items[i].Title, "週次 ") {
			found = &board.Items[i]
			break
		}
	}
	if found == nil {
		t.Fatal("expanded item missing")
	}
	okTitle := found.Title == wantTitle || found.Title == altTitle
	okDesc := found.Description == wantDesc || found.Description == altDesc
	if !okTitle || !okDesc {
		t.Fatalf("got title=%q desc=%q want ~%q / %q", found.Title, found.Description, wantTitle, wantDesc)
	}
	if strings.Contains(found.Title, "{{") || strings.Contains(found.Description, "{{") {
		t.Fatalf("placeholders left: %+v", found)
	}
	reloaded, err := loadRecurringRule(ctx, db, rule.ID)
	if err != nil || reloaded.LastFiredAt == nil {
		t.Fatalf("lastFiredAt: %+v err=%v", reloaded, err)
	}
}

func TestRunRecurringMySQLExpandOverlongFails(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	past := time.Now().UTC().Add(-48 * time.Hour)
	tpl := strings.Repeat("あ", 195) + "{{date}}"
	rule, err := r.CreateRecurringRule(ctx, 1, RecurringRuleInput{
		Name: "long", Title: tpl, Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE recurring_rules SET created_at=? WHERE id=?`, past, rule.ID)

	created, _, failed, err := r.RunRecurring(ctx)
	if err != nil || created != 0 || failed != 1 {
		t.Fatalf("created=%d failed=%d err=%v", created, failed, err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range board.Items {
		if strings.Contains(item.Title, "あ") || strings.Contains(item.Title, "{{") {
			t.Fatalf("unexpected item: %+v", item)
		}
	}
	reloaded, err := loadRecurringRule(ctx, db, rule.ID)
	if err != nil || reloaded.LastFiredAt != nil || !reloaded.Enabled {
		t.Fatalf("failed rule state: %+v err=%v", reloaded, err)
	}
}

func TestRunRecurringMySQLConcurrentNoDoubleCreate(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	past := time.Now().UTC().Add(-48 * time.Hour)
	rule, err := r.CreateRecurringRule(ctx, 1, RecurringRuleInput{
		Name: "concurrent", Title: "once-only", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `UPDATE recurring_rules SET created_at=? WHERE id=?`, past, rule.ID)

	var wg sync.WaitGroup
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			created, _, _, err := r.RunRecurring(ctx)
			if err != nil {
				t.Errorf("run: %v", err)
				results <- -1
				return
			}
			results <- created
		}()
	}
	wg.Wait()
	close(results)
	total := 0
	for c := range results {
		if c < 0 {
			t.Fatal("run error")
		}
		total += c
	}
	if total != 1 {
		t.Fatalf("created sum=%d want 1", total)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, item := range board.Items {
		if item.Title == "once-only" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("items=%d want 1", n)
	}
}

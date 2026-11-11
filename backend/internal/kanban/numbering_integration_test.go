package kanban

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Only explicitly named disposable databases may be reset by this suite.
func numberingDB(t *testing.T, suffix string) *sql.DB {
	t.Helper()
	dsn := os.Getenv("KANBAN_TEST_DSN")
	if dsn == "" {
		t.Skip("KANBAN_TEST_DSN is not set: real MySQL numbering tests skipped")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBName != "scrumboard_numbering_test" {
		t.Fatal("KANBAN_TEST_DSN must target disposable scrumboard_numbering_test")
	}
	cfg.DBName += suffix
	cfg.ParseTime = true
	cfg.MultiStatements = true
	cfg.Loc = time.UTC
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(12)
	for _, table := range []string{"card_numbers", "card_number_sequence", "cards", "board_columns"} {
		if _, err = db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := os.ReadFile("../../../database/init/001_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	return db
}
func mustInit(t *testing.T, r MySQLRepository) {
	t.Helper()
	if err := r.InitializeNumbers(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestMySQLNumberingFresh(t *testing.T) {
	db := numberingDB(t, "_fresh")
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	c, err := r.CreateCard(context.Background(), CardInput{ColumnID: 1, Title: "first user task"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Number != 2 {
		t.Fatalf("first user card number=%d, want 2", c.Number)
	}
	mustInit(t, r)
	c2, err := r.GetCard(context.Background(), c.ID)
	if err != nil || c2.Number != 2 {
		t.Fatalf("restart changed number: %+v %v", c2, err)
	}
}
func TestMySQLNumberingLegacyAndConcurrency(t *testing.T) {
	db := numberingDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	for _, id := range []int64{17, 18} {
		_, err := db.Exec(`INSERT INTO cards(id,column_id,title,description,created_at,updated_at)
 SELECT ?,1,?, 'keep description',DATE_ADD(created_at,INTERVAL 1 MINUTE),DATE_ADD(created_at,INTERVAL 1 MINUTE) FROM cards WHERE id=1`, id, "legacy title")
		if err != nil {
			t.Fatal(err)
		}
	}
	type original struct {
		ID, ColumnID         int64
		Title, Description   string
		CreatedAt, UpdatedAt time.Time
	}
	before := map[int64]original{}
	rows, err := db.Query("SELECT id,column_id,title,description,created_at,updated_at FROM cards")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c original
		if err = rows.Scan(&c.ID, &c.ColumnID, &c.Title, &c.Description, &c.CreatedAt, &c.UpdatedAt); err != nil {
			t.Fatal(err)
		}
		before[c.ID] = c
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	mustInit(t, r)
	for index, id := range []int64{1, 17, 18} {
		c, err := r.GetCard(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if c.Number != int64(index+1) {
			t.Fatalf("id %d number %d", id, c.Number)
		}
		got := original{c.ID, c.ColumnID, c.Title, c.Description, c.CreatedAt, c.UpdatedAt}
		if !reflect.DeepEqual(got, before[id]) {
			t.Fatalf("migration changed original card: %+v", got)
		}
	}
	mustInit(t, r)
	if _, err = r.CreateCard(ctx, CardInput{ColumnID: 999999, Title: "invalid column"}); !errors.Is(err, ErrColumn) {
		t.Fatalf("wrong failure %v", err)
	}
	// A failure after the cards INSERT must roll the card and number back together.
	if _, err = db.Exec(`ALTER TABLE card_numbers ADD CONSTRAINT reject_new_number CHECK (task_number <= 3)`); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "must roll back"}); err == nil {
		t.Fatal("expected check constraint failure")
	}
	if _, err = db.Exec("ALTER TABLE card_numbers DROP CHECK reject_new_number"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM cards").Scan(&count); err != nil || count != 3 {
		t.Fatalf("failed create left card: %d %v", count, err)
	}
	c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "number four"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Number != 4 || c.ID <= 4 {
		t.Fatalf("number is tied to internal ID: %+v", c)
	}
	const writers = 20
	result := make(chan Card, writers)
	errs := make(chan error, writers+4)
	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			card, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "parallel"})
			if err != nil {
				errs <- err
				return
			}
			result <- card
		}()
	}
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.InitializeNumbers(ctx); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(result)
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if t.Failed() {
		return
	}
	numbers := []int{}
	var highest Card
	for card := range result {
		numbers = append(numbers, int(card.Number))
		if card.Number > highest.Number {
			highest = card
		}
	}
	sort.Ints(numbers)
	if len(numbers) != writers {
		t.Fatal(numbers)
	}
	for i, n := range numbers {
		if n != i+5 {
			t.Fatalf("non-consecutive numbers %v", numbers)
		}
	}
	if err = r.DeleteCard(ctx, highest.ID); err != nil {
		t.Fatal(err)
	}
	mustInit(t, r)
	next, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "after deletion"})
	if err != nil || next.Number != 25 {
		t.Fatalf("deleted number reused: %+v %v", next, err)
	}
	doing := int64(2)
	updated, err := r.UpdateCard(ctx, 17, CardPatch{ColumnID: &doing})
	if err != nil || updated.Number != 2 || updated.ID != 17 {
		t.Fatalf("update changed identity: %+v %v", updated, err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, card := range board.Cards {
		if card.Number < 1 {
			t.Fatal("board omits number", card)
		}
	}
}

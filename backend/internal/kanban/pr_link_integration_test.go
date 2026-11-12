package kanban

import (
	"context"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestMySQLPRLinks(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	before, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the existing database before this feature was deployed.
	if _, err = db.Exec("DROP TABLE card_pr_links"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = r.InitializePRLinks(ctx); err != nil {
			t.Fatal(err)
		}
	}
	after, err := r.GetCard(ctx, 1)
	if err != nil || !reflect.DeepEqual(before, after) || after.PRURL != "" {
		t.Fatalf("migration mutated existing card: %+v %v", after, err)
	}
	url := "https://github.com/poteto317/scrum-board/pull/2"
	c, err := r.UpdateCard(ctx, 1, CardPatch{PRURL: &url})
	if err != nil || c.PRURL != url || c.Number != before.Number || c.Title != before.Title || !c.CreatedAt.Equal(before.CreatedAt) {
		t.Fatalf("save: %+v %v", c, err)
	}
	if err = r.InitializePRLinks(ctx); err != nil {
		t.Fatal(err)
	}
	byNumber, err := r.GetCardByNumber(ctx, before.Number)
	if err != nil || byNumber.PRURL != url {
		t.Fatalf("restart: %+v %v", byNumber, err)
	}
	board, err := r.Board(ctx)
	if err != nil || board.Cards[0].PRURL != url {
		t.Fatalf("board: %+v %v", board, err)
	}
	// Parallel disjoint partial updates serialize on the card lock and preserve each other.
	title := "updated title"
	url2 := "https://github.com/poteto317/scrum-board/pull/3"
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, p := range []CardPatch{{Title: &title}, {PRURL: &url2}} {
		wg.Add(1)
		go func(p CardPatch) { defer wg.Done(); _, e := r.UpdateCard(ctx, 1, p); errs <- e }(p)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	c, err = r.GetCard(ctx, 1)
	if err != nil || c.Title != title || c.PRURL != url2 {
		t.Fatalf("parallel updates: %+v %v", c, err)
	}
	// Fail URL persistence after the card UPDATE and verify the whole transaction rolls back.
	tooLong := strings.Repeat("x", 2049)
	failedTitle := "must roll back"
	if _, err = r.UpdateCard(ctx, 1, CardPatch{Title: &failedTitle, PRURL: &tooLong}); err == nil {
		t.Fatal("expected URL storage failure")
	}
	rollback, e := r.GetCard(ctx, 1)
	if e != nil || !reflect.DeepEqual(c, rollback) {
		t.Fatalf("partial write: %+v %v", rollback, e)
	}
	empty := ""
	cleared, err := r.UpdateCard(ctx, 1, CardPatch{PRURL: &empty})
	if err != nil || cleared.PRURL != "" {
		t.Fatalf("clear: %+v %v", cleared, err)
	}
	created, err := r.CreateCard(ctx, CardInput{Title: "new", ColumnID: 1, PRURL: url})
	if err != nil || created.PRURL != url {
		t.Fatalf("create: %+v %v", created, err)
	}
	if err = r.DeleteCard(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM card_pr_links WHERE card_id=?", created.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade: %d %v", count, err)
	}
}

func TestMySQLPRLinksConcurrentFirstSave(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	ctx := context.Background()
	var cards []Card
	for i := 0; i < 30; i++ {
		c, err := r.CreateCard(ctx, CardInput{Title: "unlinked", ColumnID: 1})
		if err != nil {
			t.Fatal(err)
		}
		cards = append(cards, c)
	}
	start := make(chan struct{})
	errs := make(chan error, len(cards))
	url := "https://github.com/poteto317/scrum-board/pull/3"
	var wg sync.WaitGroup
	for _, c := range cards {
		wg.Add(1)
		go func(c Card) {
			defer wg.Done()
			<-start
			_, err := r.UpdateCard(ctx, c.ID, CardPatch{PRURL: &url})
			errs <- err
		}(c)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent first save: %v", err)
		}
	}
	for _, c := range cards {
		got, err := r.GetCard(ctx, c.ID)
		if err != nil || got.PRURL != url {
			t.Errorf("card %d link missing: %+v %v", c.ID, got, err)
		}
	}
}

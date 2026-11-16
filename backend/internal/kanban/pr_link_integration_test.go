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
	before, err := r.GetItem(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the existing database before multi-PR was deployed (single-URL schema).
	if _, err = db.Exec("DROP TABLE item_pr_links"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TABLE item_pr_links (
 card_id BIGINT NOT NULL PRIMARY KEY,
 pr_url VARCHAR(2048) NOT NULL,
 CONSTRAINT fk_item_pr_links_card FOREIGN KEY(card_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`); err != nil {
		t.Fatal(err)
	}
	kept := "https://github.com/poteto317/scrum-board/pull/99"
	if _, err = db.Exec(`INSERT INTO item_pr_links(card_id,pr_url) VALUES(1,?)`, kept); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = r.InitializePRLinks(ctx); err != nil {
			t.Fatal(err)
		}
	}
	after, err := r.GetItem(ctx, 1)
	if err != nil || !reflect.DeepEqual(after.PRURLs, []string{kept}) {
		t.Fatalf("migration lost URL: %+v %v", after, err)
	}
	empty := []string{}
	if _, err = r.UpdateItem(ctx, 1, ItemPatch{PRURLs: &empty}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name='item_pr_links' AND column_name='position'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("position column missing: %d %v", n, err)
	}
	url := "https://github.com/poteto317/scrum-board/pull/2"
	urls := []string{url}
	c, err := r.UpdateItem(ctx, 1, ItemPatch{PRURLs: &urls})
	if err != nil || !reflect.DeepEqual(c.PRURLs, urls) || c.Number != before.Number || c.Title != before.Title || !c.CreatedAt.Equal(before.CreatedAt) {
		t.Fatalf("save: %+v %v", c, err)
	}
	if err = r.InitializePRLinks(ctx); err != nil {
		t.Fatal(err)
	}
	byNumber, err := r.GetItemByNumber(ctx, before.Number)
	if err != nil || !reflect.DeepEqual(byNumber.PRURLs, urls) {
		t.Fatalf("restart: %+v %v", byNumber, err)
	}
	board, err := r.Board(ctx)
	if err != nil || !reflect.DeepEqual(board.Items[0].PRURLs, urls) {
		t.Fatalf("board: %+v %v", board, err)
	}
	title := "updated title"
	url2 := "https://github.com/poteto317/scrum-board/pull/3"
	urls2 := []string{url, url2}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, p := range []ItemPatch{{Title: &title}, {PRURLs: &urls2}} {
		wg.Add(1)
		go func(p ItemPatch) { defer wg.Done(); _, e := r.UpdateItem(ctx, 1, p); errs <- e }(p)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	c, err = r.GetItem(ctx, 1)
	if err != nil || c.Title != title || !reflect.DeepEqual(c.PRURLs, urls2) {
		t.Fatalf("parallel updates: %+v %v", c, err)
	}
	tooLong := []string{strings.Repeat("x", 2049)}
	failedTitle := "must roll back"
	if _, err = r.UpdateItem(ctx, 1, ItemPatch{Title: &failedTitle, PRURLs: &tooLong}); err == nil {
		t.Fatal("expected URL storage failure")
	}
	rollback, e := r.GetItem(ctx, 1)
	if e != nil || !reflect.DeepEqual(c, rollback) {
		t.Fatalf("partial write: %+v %v", rollback, e)
	}
	cleared, err := r.UpdateItem(ctx, 1, ItemPatch{PRURLs: &empty})
	if err != nil || len(cleared.PRURLs) != 0 {
		t.Fatalf("clear: %+v %v", cleared, err)
	}
	created, err := r.CreateItem(ctx, ItemInput{Title: "new", ColumnID: 1, PRURLs: []string{url, url2}})
	if err != nil || !reflect.DeepEqual(created.PRURLs, []string{url, url2}) {
		t.Fatalf("create: %+v %v", created, err)
	}
	if err = r.DeleteItem(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM item_pr_links WHERE card_id=?", created.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade: %d %v", count, err)
	}
}

func TestMySQLPRLinksMigrateRecoversNewOnly(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	url := "https://github.com/poteto317/scrum-board/pull/7"
	if _, err := r.UpdateItem(ctx, 1, ItemPatch{PRURLs: &[]string{url}}); err != nil {
		t.Fatal(err)
	}
	// Simulate DROP succeeded but RENAME failed: only __new remains.
	if _, err := db.Exec("RENAME TABLE item_pr_links TO item_pr_links__new"); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializePRLinks(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetItem(ctx, 1)
	if err != nil || !reflect.DeepEqual(got.PRURLs, []string{url}) {
		t.Fatalf("recover: %+v %v", got, err)
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name='item_pr_links__new'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("__new leftover: %d %v", n, err)
	}
}

func TestMySQLPRLinksConcurrentFirstSave(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	ctx := context.Background()
	var cards []Item
	for i := 0; i < 30; i++ {
		c, err := r.CreateItem(ctx, ItemInput{Title: "unlinked", ColumnID: 1})
		if err != nil {
			t.Fatal(err)
		}
		cards = append(cards, c)
	}
	start := make(chan struct{})
	errs := make(chan error, len(cards))
	url := "https://github.com/poteto317/scrum-board/pull/3"
	urls := []string{url}
	var wg sync.WaitGroup
	for _, c := range cards {
		wg.Add(1)
		go func(c Item) {
			defer wg.Done()
			<-start
			_, err := r.UpdateItem(ctx, c.ID, ItemPatch{PRURLs: &urls})
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
		got, err := r.GetItem(ctx, c.ID)
		if err != nil || !reflect.DeepEqual(got.PRURLs, urls) {
			t.Errorf("card %d link missing: %+v %v", c.ID, got, err)
		}
	}
}

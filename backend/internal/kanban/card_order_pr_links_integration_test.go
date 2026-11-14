package kanban

import (
	"context"
	"reflect"
	"testing"
)

// A card with several PR links must reach every board-facing read once, with all of its links in registration
// order, however the card was moved: the card list is not allowed to be joined to card_pr_links (one row per PR).
func newLinkedBoard(t *testing.T) (r MySQLRepository, two, three, none Card) {
	t.Helper()
	r, _, _ = newOrderedBoard(t)
	ctx := context.Background()
	mk := func(title string, urls []string) Card {
		c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: title, PRURLs: urls})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	two = mk("two", []string{"https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"})
	three = mk("three", []string{"https://github.com/o/r/pull/3", "https://github.com/o/r/pull/4", "https://github.com/o/r/pull/5"})
	none = mk("none", nil)
	return
}

// assertLinkedCards checks a card list: every card exactly once, links intact and in order, [] (not null) for none.
func assertLinkedCards(t *testing.T, where string, cards []Card, two, three, none Card) {
	t.Helper()
	seen := map[int64]int{}
	for _, c := range cards {
		seen[c.ID]++
		var want []string
		switch c.ID {
		case two.ID:
			want = two.PRURLs
		case three.ID:
			want = three.PRURLs
		default:
			want = []string{}
		}
		if c.PRURLs == nil || !reflect.DeepEqual(c.PRURLs, want) {
			t.Fatalf("%s: card %d prUrls = %#v, want %#v", where, c.ID, c.PRURLs, want)
		}
	}
	for _, id := range []int64{two.ID, three.ID, none.ID} {
		if seen[id] != 1 {
			t.Fatalf("%s: card %d returned %d times, want once: %+v", where, id, seen[id], cards)
		}
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("%s: card %d returned %d times", where, id, n)
		}
	}
}

func TestMultiPRCardsStayWholeThroughEveryReadAndMoveMySQL(t *testing.T) {
	r, two, three, none := newLinkedBoard(t)
	ctx := context.Background()
	total := 6 // the seed card and a, b from newOrderedBoard, plus the three linked cards

	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Cards) != total {
		t.Fatalf("Board returned %d cards, want %d (a PR-link join would repeat cards): %+v", len(board.Cards), total, board.Cards)
	}
	assertLinkedCards(t, "Board", board.Cards, two, three, none)
	for _, c := range []Card{two, three} {
		got, err := r.GetCard(ctx, c.ID)
		if err != nil || !reflect.DeepEqual(got.PRURLs, c.PRURLs) {
			t.Fatalf("GetCard %d: %#v %v", c.ID, got.PRURLs, err)
		}
		got, err = r.GetCardByNumber(ctx, c.Number)
		if err != nil || !reflect.DeepEqual(got.PRURLs, c.PRURLs) {
			t.Fatalf("GetCardByNumber %d: %#v %v", c.Number, got.PRURLs, err)
		}
	}

	// ReorderCards: inside a column, then across columns. The result and the stored board both keep every link.
	ids := idsByPosition(t, r, 1)
	rev := make([]int64, len(ids))
	for i, id := range ids {
		rev[len(ids)-1-i] = id
	}
	cards, err := r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: rev}})
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != total {
		t.Fatalf("ReorderCards returned %d cards, want %d", len(cards), total)
	}
	assertLinkedCards(t, "ReorderCards within a column", cards, two, three, none)

	var rest []int64
	for _, id := range ids {
		if id != two.ID && id != three.ID {
			rest = append(rest, id)
		}
	}
	cards, err = r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: rest},
		{ColumnID: 2, CardIDs: []int64{three.ID, two.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertLinkedCards(t, "ReorderCards across columns", cards, two, three, none)
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	assertLinkedCards(t, "Board after ReorderCards", board.Cards, two, three, none)
	for _, c := range []Card{two, three} {
		page, err := r.History(ctx, c.Number, 0)
		if err != nil {
			t.Fatal(err)
		}
		move := page.Events[0]
		if move.Kind != "updated" || len(move.Changes) != 1 || move.Changes[0].Field != "status" {
			t.Fatalf("moving card %d through ReorderCards must record only a status change: %+v", c.ID, page.Events)
		}
	}

	// UpdateCard's column move.
	doing := int64(2)
	moved, err := r.UpdateCard(ctx, three.ID, CardPatch{ColumnID: &doing})
	if err != nil {
		t.Fatal(err)
	}
	if moved.ColumnID != 2 || !reflect.DeepEqual(moved.PRURLs, three.PRURLs) {
		t.Fatalf("UpdateCard move: %+v", moved)
	}
	page, err := r.History(ctx, three.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Events[0].Changes) > 1 {
		t.Fatalf("a column move must not touch prUrls in the history: %+v", page.Events[0])
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	assertLinkedCards(t, "Board after UpdateCard move", board.Cards, two, three, none)

	// Backlog read and reorder.
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(backlog) != total {
		t.Fatalf("Backlog returned %d cards, want %d", len(backlog), total)
	}
	assertLinkedCards(t, "Backlog", backlog, two, three, none)
	order := make([]int64, 0, len(backlog))
	for i := len(backlog) - 1; i >= 0; i-- {
		order = append(order, backlog[i].ID)
	}
	backlog, err = r.ReorderBacklog(ctx, order)
	if err != nil {
		t.Fatal(err)
	}
	assertLinkedCards(t, "ReorderBacklog", backlog, two, three, none)

	// The links themselves are untouched, and a later edit of them diffs against the full list.
	urls := append(append([]string(nil), two.PRURLs...), "https://github.com/o/r/pull/9")
	edited, err := r.UpdateCard(ctx, two.ID, CardPatch{PRURLs: &urls})
	if err != nil || !reflect.DeepEqual(edited.PRURLs, urls) {
		t.Fatalf("UpdateCard links: %#v %v", edited.PRURLs, err)
	}
	page, err = r.History(ctx, two.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := HistoryChange{Field: "prUrls", Before: prURLsJSON(two.PRURLs), After: prURLsJSON(urls)}
	if ch := page.Events[0].Changes; len(ch) != 1 || ch[0] != want {
		t.Fatalf("link edit history = %+v, want only %+v", ch, want)
	}
}

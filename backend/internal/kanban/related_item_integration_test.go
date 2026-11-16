package kanban

import (
	"context"
	"reflect"
	"testing"
)

func TestMySQLRelatedItemsBidirectional(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustInit(t, r)

	a, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "alpha"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "beta"})
	if err != nil {
		t.Fatal(err)
	}

	items := []RelatedItem{
		{Kind: "item", Number: b.Number, Label: "depends"},
		{Kind: "url", URL: "https://example.com/doc", Label: "仕様"},
	}
	updated, err := r.UpdateItem(ctx, a.ID, ItemPatch{RelatedItems: &items})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.RelatedItems) != 2 {
		t.Fatalf("a related: %+v", updated.RelatedItems)
	}
	if updated.RelatedItems[0].Number != b.Number || updated.RelatedItems[0].Title != "beta" {
		t.Fatalf("card item: %+v", updated.RelatedItems[0])
	}

	peer, err := r.GetItem(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(peer.RelatedItems) != 1 || peer.RelatedItems[0].Number != a.Number || peer.RelatedItems[0].Label != "" {
		t.Fatalf("peer reverse: %+v", peer.RelatedItems)
	}

	histA, err := r.History(ctx, a.ID, 0)
	if err != nil || len(histA.Events) == 0 {
		t.Fatalf("history a: %+v %v", histA, err)
	}
	foundRelated := false
	for _, ev := range histA.Events {
		for _, ch := range ev.Changes {
			if ch.Field == "relatedItems" {
				foundRelated = true
			}
		}
	}
	if !foundRelated {
		t.Fatalf("expected relatedItems in a history: %+v", histA.Events)
	}
	histB, err := r.History(ctx, b.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundPeer := false
	for _, ev := range histB.Events {
		for _, ch := range ev.Changes {
			if ch.Field == "relatedItems" {
				foundPeer = true
			}
		}
	}
	if !foundPeer {
		t.Fatalf("expected relatedItems in b history: %+v", histB.Events)
	}

	titleOnly := "alpha2"
	kept, err := r.UpdateItem(ctx, a.ID, ItemPatch{Title: &titleOnly})
	if err != nil || !reflect.DeepEqual(kept.RelatedItems, updated.RelatedItems) {
		t.Fatalf("omit relatedItems wiped: %+v %v", kept, err)
	}

	empty := []RelatedItem{}
	cleared, err := r.UpdateItem(ctx, a.ID, ItemPatch{RelatedItems: &empty})
	if err != nil || len(cleared.RelatedItems) != 0 {
		t.Fatalf("clear: %+v %v", cleared, err)
	}
	peer, err = r.GetItem(ctx, b.ID)
	if err != nil || len(peer.RelatedItems) != 0 {
		t.Fatalf("peer after clear: %+v %v", peer, err)
	}

	self := []RelatedItem{{Kind: "item", Number: a.Number}}
	if _, err = r.UpdateItem(ctx, a.ID, ItemPatch{RelatedItems: &self}); err != ErrRelatedItem {
		t.Fatalf("self: %v", err)
	}
	missing := []RelatedItem{{Kind: "item", Number: 999999}}
	if _, err = r.UpdateItem(ctx, a.ID, ItemPatch{RelatedItems: &missing}); err != ErrRelatedItem {
		t.Fatalf("missing: %v", err)
	}
}

func TestMySQLRelatedItemsMigratesLegacyCardKind(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustInit(t, r)

	a, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "peer"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx,
		`INSERT INTO item_related_items (card_id, position, kind, related_card_id, url, label) VALUES (?, 0, 'card', ?, NULL, '')`,
		a.ID, b.ID,
	); err != nil {
		t.Fatal(err)
	}

	if err = r.InitializeRelatedItems(ctx); err != nil {
		t.Fatal(err)
	}
	var kind string
	if err = db.QueryRowContext(ctx,
		`SELECT kind FROM item_related_items WHERE card_id=? AND position=0`, a.ID,
	).Scan(&kind); err != nil || kind != "item" {
		t.Fatalf("kind after migrate: %q %v", kind, err)
	}
	got, err := r.GetItem(ctx, a.ID)
	if err != nil || len(got.RelatedItems) != 1 || got.RelatedItems[0].Kind != "item" || got.RelatedItems[0].Number != b.Number {
		t.Fatalf("read after migrate: %+v %v", got.RelatedItems, err)
	}
}

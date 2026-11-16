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

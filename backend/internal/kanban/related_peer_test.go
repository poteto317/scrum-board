package kanban

import "testing"

func TestRelatedItemPeersDiff(t *testing.T) {
	a := RelatedItem{Kind: relatedKindItem, Number: 1, ProjectID: 1}
	b := RelatedItem{Kind: relatedKindItem, Number: 2, ProjectID: 1}
	url := RelatedItem{Kind: relatedKindURL, URL: "https://example.com"}
	got := relatedItemPeersDiff([]RelatedItem{a, url}, []RelatedItem{b, url})
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %+v", len(got), got)
	}
	seen := map[int64]bool{}
	for _, rel := range got {
		seen[rel.Number] = true
	}
	if !seen[1] || !seen[2] {
		t.Fatalf("diff peers: %+v", got)
	}
	if len(relatedItemPeersDiff([]RelatedItem{a}, []RelatedItem{a})) != 0 {
		t.Fatal("unchanged should be empty")
	}
}

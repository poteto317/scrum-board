package kanban

import (
	"strings"
	"testing"
)

func TestNormalizeRelatedItems(t *testing.T) {
	t.Parallel()
	ok, valid := normalizeRelatedItems([]RelatedItem{
		{Kind: "item", Number: 3, ProjectID: 1, Title: "ignored", Label: "  a  "},
		{Kind: "url", URL: "  HTTPS://example.com/x  ", Label: ""},
	})
	if !valid || len(ok) != 2 {
		t.Fatalf("got %+v valid=%v", ok, valid)
	}
	if ok[0].Title != "" || ok[0].Label != "a" || ok[0].Number != 3 || ok[0].ProjectID != 1 {
		t.Fatalf("card: %+v", ok[0])
	}
	if ok[1].URL != "HTTPS://example.com/x" {
		t.Fatalf("url: %+v", ok[1])
	}

	cases := []struct {
		name  string
		items []RelatedItem
	}{
		{"self-shaped dup number", []RelatedItem{{Kind: "item", Number: 1, ProjectID: 1}, {Kind: "item", Number: 1, ProjectID: 1}}},
		{"dup url", []RelatedItem{{Kind: "url", URL: "https://a.com"}, {Kind: "url", URL: "https://a.com"}}},
		{"bad kind", []RelatedItem{{Kind: "file", URL: "https://a.com"}}},
		{"bad number", []RelatedItem{{Kind: "item", Number: 0, ProjectID: 1}}},
		{"missing project", []RelatedItem{{Kind: "item", Number: 1}}},
		{"ftp", []RelatedItem{{Kind: "url", URL: "ftp://a.com"}}},
		{"too long label", []RelatedItem{{Kind: "url", URL: "https://a.com", Label: strings.Repeat("あ", relatedLabelMax+1)}}},
		{"too long url", []RelatedItem{{Kind: "url", URL: "https://a.com/" + strings.Repeat("x", relatedURLMax)}}},
		{"newline url", []RelatedItem{{Kind: "url", URL: "https://a.com/\n"}}},
		{"label control", []RelatedItem{{Kind: "url", URL: "https://a.com", Label: "a\tb"}}},
	}
	for _, tc := range cases {
		if _, valid := normalizeRelatedItems(tc.items); valid {
			t.Fatalf("%s: expected invalid", tc.name)
		}
	}
	empty, valid := normalizeRelatedItems(nil)
	if !valid || empty == nil || len(empty) != 0 {
		t.Fatalf("nil: %+v %v", empty, valid)
	}
}

func TestRelatedItemsJSONOmitsTitle(t *testing.T) {
	t.Parallel()
	got := relatedItemsJSON([]RelatedItem{{Kind: "item", Number: 2, ProjectID: 1, Title: "T", Label: "L"}})
	if strings.Contains(got, "title") || !strings.Contains(got, `"number":2`) || !strings.Contains(got, `"projectId":1`) {
		t.Fatalf("got %s", got)
	}
}

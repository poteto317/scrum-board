package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestItemSolutionAPI(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"sol","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "" {
		t.Fatalf("default solution: %q", card.Solution)
	}

	board := request(h, "GET", "/api/board", "")
	if board.Code != 200 {
		t.Fatalf("board: %d", board.Code)
	}
	if !strings.Contains(board.Body.String(), `"solution"`) {
		t.Fatalf("board missing solution key: %s", board.Body.String())
	}

	byID := request(h, "GET", "/api/items/"+strconv.FormatInt(card.ID, 10), "")
	if byID.Code != 200 {
		t.Fatalf("get id: %d", byID.Code)
	}
	var got Item
	if err := json.Unmarshal(byID.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Solution != "" {
		t.Fatalf("get id solution: %q", got.Solution)
	}

	byNum := request(h, "GET", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10), "")
	if byNum.Code != 200 {
		t.Fatalf("by-number: %d", byNum.Code)
	}
	if err := json.Unmarshal(byNum.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Solution != "" {
		t.Fatalf("by-number solution: %q", got.Solution)
	}

	withBody := request(h, "POST", "/api/items", `{"title":"with sol","description":"d","columnId":1,"solution":"  keep\nspaces  "}`)
	if withBody.Code != 201 {
		t.Fatalf("create with solution: %d %s", withBody.Code, withBody.Body.String())
	}
	if err := json.Unmarshal(withBody.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "  keep\nspaces  " {
		t.Fatalf("create preserves whitespace: %q", card.Solution)
	}

	idPath := "/api/items/" + strconv.FormatInt(card.ID, 10)
	descBefore := card.Description
	prBefore := append([]string(nil), card.PRURLs...)
	relatedBefore := append([]RelatedItem(nil), card.RelatedItems...)

	w := request(h, "PATCH", idPath, `{"solution":"line1\n  line2  "}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "line1\n  line2  " {
		t.Fatalf("saved: %q", card.Solution)
	}
	if card.Description != descBefore {
		t.Fatalf("L-015 description changed: %q", card.Description)
	}
	if len(card.PRURLs) != len(prBefore) {
		t.Fatalf("L-015 prUrls changed")
	}
	if len(card.RelatedItems) != len(relatedBefore) {
		t.Fatalf("L-015 relatedItems changed")
	}

	omit := request(h, "PATCH", idPath, `{"title":"with sol2"}`)
	if omit.Code != 200 {
		t.Fatalf("omit: %d %s", omit.Code, omit.Body.String())
	}
	if err := json.Unmarshal(omit.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "line1\n  line2  " {
		t.Fatalf("omit should keep: %q", card.Solution)
	}

	nullBody := request(h, "PATCH", idPath, `{"solution":null,"title":"with sol3"}`)
	if nullBody.Code != 200 {
		t.Fatalf("null: %d %s", nullBody.Code, nullBody.Body.String())
	}
	if err := json.Unmarshal(nullBody.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "line1\n  line2  " {
		t.Fatalf("null should keep: %q", card.Solution)
	}

	same := request(h, "PATCH", idPath, `{"solution":"line1\n  line2  "}`)
	if same.Code != 200 {
		t.Fatalf("same: %d", same.Code)
	}

	overflow := request(h, "PATCH", idPath, `{"solution":"`+strings.Repeat("あ", 10001)+`"}`)
	if overflow.Code != 400 {
		t.Fatalf("overflow: %d", overflow.Code)
	}
	maxOK := request(h, "PATCH", idPath, `{"solution":"`+strings.Repeat("あ", 10000)+`"}`)
	if maxOK.Code != 200 {
		t.Fatalf("max: %d %s", maxOK.Code, maxOK.Body.String())
	}

	solo := request(h, "POST", "/api/items", `{"title":"solo","description":"d","columnId":1}`)
	if solo.Code != 201 {
		t.Fatalf("solo create: %d", solo.Code)
	}
	if err := json.Unmarshal(solo.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	soloPatch := request(h, "PATCH", "/api/items/"+strconv.FormatInt(card.ID, 10), `{"solution":"only"}`)
	if soloPatch.Code != 200 {
		t.Fatalf("solo patch: %d %s", soloPatch.Code, soloPatch.Body.String())
	}

	clear := request(h, "PATCH", "/api/items/"+strconv.FormatInt(card.ID, 10), `{"solution":""}`)
	if clear.Code != 200 {
		t.Fatalf("clear: %d", clear.Code)
	}
	if err := json.Unmarshal(clear.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Solution != "" {
		t.Fatalf("clear: %q", card.Solution)
	}
}

func TestValidDescriptionRejectsInvalidUTF8(t *testing.T) {
	t.Parallel()
	if validDescription("\xff") {
		t.Fatal("expected invalid UTF-8 to fail (solution uses same check)")
	}
}

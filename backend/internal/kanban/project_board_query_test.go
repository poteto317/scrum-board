package kanban

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestBoardQueryProjectIdScopesItemsWithoutChangingActive(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	seed := request(h, "POST", "/api/projects", `{"name":"other"}`)
	if seed.Code != 201 {
		t.Fatalf("create project: %d %s", seed.Code, seed.Body)
	}
	var other Project
	if err := json.Unmarshal(seed.Body.Bytes(), &other); err != nil {
		t.Fatal(err)
	}
	activeBefore := repo.resolvedActive()
	if activeBefore == other.ID {
		t.Fatal("expected default active to differ from other")
	}

	todo := mustColumnID(t, h, "Todo")
	aCard := request(h, "POST", "/api/items", `{"columnId":`+itoa(todo)+`,"title":"on-active"}`)
	if aCard.Code != 201 {
		t.Fatalf("create active card: %d %s", aCard.Code, aCard.Body)
	}
	if w := request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(other.ID)+`}`); w.Code != 200 {
		t.Fatalf("switch active: %d %s", w.Code, w.Body)
	}
	bCard := request(h, "POST", "/api/items", `{"columnId":`+itoa(todo)+`,"title":"on-other"}`)
	if bCard.Code != 201 {
		t.Fatalf("create other card: %d %s", bCard.Code, bCard.Body)
	}
	if w := request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(activeBefore)+`}`); w.Code != 200 {
		t.Fatalf("restore active: %d %s", w.Code, w.Body)
	}

	omit := request(h, "GET", "/api/board", "")
	if omit.Code != 200 {
		t.Fatalf("omit: %d %s", omit.Code, omit.Body)
	}
	var omitBoard Board
	if err := json.Unmarshal(omit.Body.Bytes(), &omitBoard); err != nil {
		t.Fatal(err)
	}
	if omitBoard.Settings.ActiveProjectID != activeBefore {
		t.Fatalf("omit active: got %d want %d", omitBoard.Settings.ActiveProjectID, activeBefore)
	}
	for _, it := range omitBoard.Items {
		if it.ProjectID != activeBefore {
			t.Fatalf("omit item project %d want %d", it.ProjectID, activeBefore)
		}
	}

	scoped := request(h, "GET", "/api/board?projectId="+itoa(other.ID), "")
	if scoped.Code != 200 {
		t.Fatalf("scoped: %d %s", scoped.Code, scoped.Body)
	}
	var scopedBoard Board
	if err := json.Unmarshal(scoped.Body.Bytes(), &scopedBoard); err != nil {
		t.Fatal(err)
	}
	if scopedBoard.Settings.ActiveProjectID != activeBefore {
		t.Fatalf("scoped must keep settings.active=%d, got %d", activeBefore, scopedBoard.Settings.ActiveProjectID)
	}
	if len(scopedBoard.Items) == 0 {
		t.Fatal("scoped expected other items")
	}
	for _, it := range scopedBoard.Items {
		if it.ProjectID != other.ID {
			t.Fatalf("scoped item project %d want %d", it.ProjectID, other.ID)
		}
	}
	if repo.resolvedActive() != activeBefore {
		t.Fatalf("DB/active changed: %d", repo.resolvedActive())
	}

	if w := request(h, "GET", "/api/board?projectId=0", ""); w.Code != 400 {
		t.Fatalf("zero: %d %s", w.Code, w.Body)
	}
	if w := request(h, "GET", "/api/board?projectId=99999", ""); w.Code != 400 {
		t.Fatalf("missing: %d %s", w.Code, w.Body)
	}
}

func TestBacklogQueryProjectIdScopesItemsWithoutChangingActive(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	seed := request(h, "POST", "/api/projects", `{"name":"other"}`)
	var other Project
	if err := json.Unmarshal(seed.Body.Bytes(), &other); err != nil {
		t.Fatal(err)
	}
	activeBefore := repo.resolvedActive()
	todo := mustColumnID(t, h, "Todo")
	if w := request(h, "POST", "/api/items", `{"columnId":`+itoa(todo)+`,"title":"on-active"}`); w.Code != 201 {
		t.Fatalf("create: %s", w.Body)
	}
	if w := request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(other.ID)+`}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := request(h, "POST", "/api/items", `{"columnId":`+itoa(todo)+`,"title":"on-other"}`); w.Code != 201 {
		t.Fatalf("create other: %s", w.Body)
	}
	if w := request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(activeBefore)+`}`); w.Code != 200 {
		t.Fatal(w.Body)
	}

	scoped := request(h, "GET", "/api/backlog?projectId="+itoa(other.ID), "")
	if scoped.Code != 200 {
		t.Fatalf("scoped backlog: %d %s", scoped.Code, scoped.Body)
	}
	var body struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(scoped.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Items) == 0 {
		t.Fatal("expected other backlog items")
	}
	for _, it := range body.Items {
		if it.ProjectID != other.ID {
			t.Fatalf("item project %d", it.ProjectID)
		}
	}
	if repo.resolvedActive() != activeBefore {
		t.Fatal("active changed")
	}
	if w := request(h, "GET", "/api/backlog?projectId=0", ""); w.Code != 400 {
		t.Fatalf("zero: %d", w.Code)
	}
}

func mustColumnID(t *testing.T, h http.Handler, name string) int64 {
	t.Helper()
	w := request(h, "GET", "/api/board", "")
	var b Board
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	for _, c := range b.Columns {
		if c.Name == name {
			return c.ID
		}
	}
	t.Fatalf("column %q not found", name)
	return 0
}

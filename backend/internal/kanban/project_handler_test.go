package kanban

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectCRUDAndNames(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	for _, body := range []string{`{"name":" "}`, `{"name":""}`, `{"name":"` + strings.Repeat("a", 81) + `"}`, `{"name":"x","extra":1}`} {
		w := request(h, "POST", "/api/projects", body)
		if w.Code != 400 {
			t.Fatalf("body %s status=%d %s", body, w.Code, w.Body)
		}
	}
	w := request(h, "POST", "/api/projects", `{"name":"  次  "}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var created Project
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "次" || created.ID == 1 || created.Position != 1 {
		t.Fatalf("created: %+v", created)
	}
	again := request(h, "POST", "/api/projects", `{"name":"次"}`)
	if again.Code != 201 {
		t.Fatalf("duplicate name: %d %s", again.Code, again.Body)
	}
	var dup Project
	if err := json.Unmarshal(again.Body.Bytes(), &dup); err != nil {
		t.Fatal(err)
	}
	if dup.ID == created.ID {
		t.Fatal("same name must still be a new id")
	}

	w = request(h, "GET", "/api/projects", "")
	var list struct {
		Projects []Project `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	if len(list.Projects) != 3 || list.Projects[0].Name != "メイン" || list.Projects[1].ID != created.ID || list.Projects[2].ID != dup.ID {
		t.Fatalf("order: %+v", list.Projects)
	}

	w = request(h, "PATCH", "/api/projects/"+itoa(created.ID), `{"name":" 改名 "}`)
	if w.Code != 200 {
		t.Fatalf("rename: %d %s", w.Code, w.Body)
	}
	var renamed Project
	if err := json.Unmarshal(w.Body.Bytes(), &renamed); err != nil || renamed.Name != "改名" || renamed.ID != created.ID {
		t.Fatalf("renamed: %+v %v", renamed, err)
	}

	if w = request(h, "DELETE", "/api/projects/"+itoa(dup.ID), ""); w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("delete empty: %d %s", w.Code, w.Body)
	}
	recreated := request(h, "POST", "/api/projects", `{"name":"次"}`)
	var re Project
	if err := json.Unmarshal(recreated.Body.Bytes(), &re); err != nil || recreated.Code != 201 || re.ID == dup.ID {
		t.Fatalf("L-455 reused id: %+v %d %s", re, recreated.Code, recreated.Body)
	}
	if w = request(h, "DELETE", "/api/projects/"+itoa(created.ID), ""); w.Code != 204 {
		t.Fatalf("delete renamed empty: %d", w.Code)
	}
	if w = request(h, "DELETE", "/api/projects/"+itoa(re.ID), ""); w.Code != 204 {
		t.Fatalf("delete recreated: %d", w.Code)
	}
	if w = request(h, "DELETE", "/api/projects/1", ""); w.Code != 409 {
		t.Fatalf("last project: %d", w.Code)
	}
	if w = request(h, "PATCH", "/api/projects/99", `{"name":"no"}`); w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
	if w = request(h, "DELETE", "/api/projects/no", ""); w.Code != 400 {
		t.Fatalf("bad id: %d", w.Code)
	}

	item := request(h, "POST", "/api/items", `{"title":"held","columnId":1}`)
	if item.Code != 201 {
		t.Fatalf("item: %d %s", item.Code, item.Body)
	}
	other := request(h, "POST", "/api/projects", `{"name":"spare"}`)
	if other.Code != 201 {
		t.Fatal(other.Body)
	}
	if w = request(h, "DELETE", "/api/projects/1", ""); w.Code != 409 {
		t.Fatalf("delete project with items: %d %s", w.Code, w.Body)
	}
}

func TestDeleteProjectClearsSprintsWhenNoItems(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	other := request(h, "POST", "/api/projects", `{"name":"spare"}`)
	var p Project
	_ = json.Unmarshal(other.Body.Bytes(), &p)
	created := request(h, "POST", "/api/sprints", `{"name":"S","startDate":"2026-11-01","endDate":"2026-11-14","projectId":`+itoa(p.ID)+`}`)
	if created.Code != 201 {
		t.Fatalf("sprint: %d %s", created.Code, created.Body)
	}
	var s Sprint
	_ = json.Unmarshal(created.Body.Bytes(), &s)
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/activate", ""); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := request(h, "DELETE", "/api/projects/"+itoa(p.ID), ""); w.Code != 204 {
		t.Fatalf("delete project clears sprints: %d %s", w.Code, w.Body)
	}
	_ = request(h, "POST", "/api/projects", `{"name":"spare2"}`)
}

func TestItemProjectScopeAndMove(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	second := request(h, "POST", "/api/projects", `{"name":"other"}`)
	var other Project
	if err := json.Unmarshal(second.Body.Bytes(), &other); err != nil || second.Code != 201 {
		t.Fatalf("project: %d %v", second.Code, err)
	}
	create := func(body string) Item {
		t.Helper()
		w := request(h, "POST", "/api/items", body)
		if w.Code != 201 {
			t.Fatalf("create %s: %d %s", body, w.Code, w.Body)
		}
		var item Item
		if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		return item
	}
	a := create(`{"title":"a","columnId":1}`)
	b := create(`{"title":"b","columnId":1}`)
	if a.ProjectID != 1 || b.ProjectID != 1 {
		t.Fatalf("nil projectId should use active: %+v %+v", a, b)
	}
	c := create(`{"title":"c","columnId":1,"projectId":` + itoa(other.ID) + `}`)
	if c.ProjectID != other.ID || c.Position != 0 || c.BacklogPosition != 0 {
		t.Fatalf("explicit project: %+v", c)
	}
	if w := request(h, "POST", "/api/items", `{"title":"bad","columnId":1,"projectId":0}`); w.Code != 400 {
		t.Fatalf("zero project: %d", w.Code)
	}
	if w := request(h, "POST", "/api/items", `{"title":"bad","columnId":1,"projectId":99}`); w.Code != 400 {
		t.Fatalf("missing project: %d", w.Code)
	}

	boardIDs := func() []int64 {
		t.Helper()
		w := request(h, "GET", "/api/board", "")
		var board Board
		if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil || w.Code != 200 {
			t.Fatalf("board: %d %v", w.Code, err)
		}
		ids := make([]int64, len(board.Items))
		for i, item := range board.Items {
			ids[i] = item.ID
		}
		return ids
	}
	if ids := boardIDs(); len(ids) != 2 || ids[0] != a.ID || ids[1] != b.ID {
		t.Fatalf("active board: %v", ids)
	}
	backlog := request(h, "GET", "/api/backlog", "")
	var backlogBody struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(backlog.Body.Bytes(), &backlogBody); err != nil || len(backlogBody.Items) != 2 {
		t.Fatalf("backlog: %s", backlog.Body)
	}

	repo.cards[c.ID] = func() Item {
		card := repo.cards[c.ID]
		card.Position = 5
		return card
	}()
	w := request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[`+itoa(b.ID)+`,`+itoa(a.ID)+`]}]}`)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	if repo.cards[c.ID].Position != 5 {
		t.Fatalf("other project position changed: %+v", repo.cards[c.ID])
	}
	if repo.cards[b.ID].Position != 0 || repo.cards[a.ID].Position != 1 {
		t.Fatalf("active order: a=%+v b=%+v", repo.cards[a.ID], repo.cards[b.ID])
	}
	if w = request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[`+itoa(b.ID)+`,`+itoa(a.ID)+`,`+itoa(c.ID)+`]}]}`); w.Code != 409 {
		t.Fatalf("foreign id: %d", w.Code)
	}
	if w = request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[`+itoa(a.ID)+`]}]}`); w.Code != 409 {
		t.Fatalf("missing id: %d", w.Code)
	}
	if repo.cards[c.ID].Position != 5 {
		t.Fatal("failed reorder changed the other project")
	}
	if w = request(h, "PUT", "/api/backlog/order", `{"itemIds":[`+itoa(c.ID)+`,`+itoa(a.ID)+`,`+itoa(b.ID)+`]}`); w.Code != 409 {
		t.Fatalf("backlog foreign: %d", w.Code)
	}

	beforeB := repo.cards[b.ID].Position
	beforeBBacklog := repo.cards[b.ID].BacklogPosition
	w = request(h, "PATCH", "/api/items/"+itoa(a.ID), `{"projectId":`+itoa(other.ID)+`}`)
	if w.Code != 200 {
		t.Fatalf("move: %d %s", w.Code, w.Body)
	}
	var moved Item
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.ProjectID != other.ID || moved.Position != 6 {
		t.Fatalf("moved to end: %+v", moved)
	}
	if repo.cards[b.ID].Position != beforeB || repo.cards[b.ID].BacklogPosition != beforeBBacklog {
		t.Fatalf("source hole filled: %+v", repo.cards[b.ID])
	}
	if repo.cards[c.ID].Position != 5 {
		t.Fatalf("dest neighbor moved: %+v", repo.cards[c.ID])
	}
}

func TestActiveProjectSettingsHTTP(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	w := request(h, "GET", "/api/board", "")
	var board Board
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil || board.Settings.ActiveProjectID != 1 {
		t.Fatalf("get active: %+v %s", board.Settings, w.Body)
	}

	repo.settings.ActiveProjectID = 999
	w = request(h, "GET", "/api/board", "")
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil || board.Settings.ActiveProjectID != 1 {
		t.Fatalf("resolved: %+v", board.Settings)
	}
	if repo.settings.ActiveProjectID != 999 {
		t.Fatal("GET rewrote raw active")
	}

	w = request(h, "PATCH", "/api/board/settings", `{"cardLayout":"free"}`)
	if w.Code != 200 {
		t.Fatalf("layout: %d %s", w.Code, w.Body)
	}
	var patched struct {
		Settings BoardSettings `json:"settings"`
		Raw      map[string]json.RawMessage
	}
	if err := json.Unmarshal(w.Body.Bytes(), &patched.Raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := patched.Raw["items"]; ok {
		t.Fatalf("layout patch included items: %s", w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Settings.CardLayout != CardLayoutFree || patched.Settings.ActiveProjectID != 1 || patched.Settings.MobileBoardColumnID != 1 {
		t.Fatalf("response: %+v", patched.Settings)
	}
	if repo.settings.ActiveProjectID != 999 || repo.settings.CardLayout != CardLayoutFree {
		t.Fatalf("raw after layout: %+v", repo.settings)
	}

	second := request(h, "POST", "/api/projects", `{"name":"other"}`)
	var other Project
	if err := json.Unmarshal(second.Body.Bytes(), &other); err != nil {
		t.Fatal(err)
	}
	w = request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(other.ID)+`}`)
	if w.Code != 200 {
		t.Fatalf("active patch: %d %s", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &patched.Raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := patched.Raw["items"]; ok {
		t.Fatalf("active-only included items: %s", w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Settings.ActiveProjectID != other.ID || patched.Settings.CardLayout != CardLayoutFree || patched.Settings.MobileBoardColumnID != 1 {
		t.Fatalf("healed response: %+v", patched.Settings)
	}
	if repo.settings.ActiveProjectID != other.ID || repo.settings.CardLayout != CardLayoutFree {
		t.Fatalf("raw healed: %+v", repo.settings)
	}
	w = request(h, "GET", "/api/board", "")
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil || board.Settings.ActiveProjectID != other.ID {
		t.Fatalf("reload: %+v", board.Settings)
	}

	for _, body := range []string{`{"activeProjectId":0}`, `{"activeProjectId":-1}`, `{"activeProjectId":99}`, `{"activeProjectId":1,"nope":true}`} {
		if w = request(h, "PATCH", "/api/board/settings", body); w.Code != 400 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body)
		}
	}
	if repo.settings.ActiveProjectID != other.ID {
		t.Fatal("rejected patch changed raw")
	}

	empty := request(h, "POST", "/api/projects", `{"name":"empty"}`)
	var doomed Project
	if err := json.Unmarshal(empty.Body.Bytes(), &doomed); err != nil {
		t.Fatal(err)
	}
	if w = request(h, "PATCH", "/api/board/settings", `{"activeProjectId":`+itoa(doomed.ID)+`}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(h, "DELETE", "/api/projects/"+itoa(doomed.ID), ""); w.Code != 204 {
		t.Fatalf("delete active empty: %d %s", w.Code, w.Body)
	}
	if repo.settings.ActiveProjectID != doomed.ID {
		t.Fatal("delete rewrote raw active")
	}
	w = request(h, "GET", "/api/board", "")
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil || board.Settings.ActiveProjectID != 1 {
		t.Fatalf("fallback after delete: %+v raw=%d", board.Settings, repo.settings.ActiveProjectID)
	}
}

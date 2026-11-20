package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func createSprintOK(t *testing.T, h http.Handler, body string) Sprint {
	t.Helper()
	w := request(h, "POST", "/api/sprints", body)
	if w.Code != 201 {
		t.Fatalf("create sprint: %d %s", w.Code, w.Body)
	}
	var s Sprint
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSprintCreateValidation(t *testing.T) {
	h := NewHandler(fresh())
	s := createSprintOK(t, h, `{"name":"Sprint A","startDate":"2026-11-21","endDate":"2026-12-04"}`)
	if s.Status != SprintStatusPlanned || s.Velocity != nil || s.Name != "Sprint A" || s.Goal != "" {
		t.Fatalf("created: %+v", s)
	}
	if w := request(h, "POST", "/api/sprints", `{"name":"  ","startDate":"2026-11-21","endDate":"2026-12-04"}`); w.Code != 400 {
		t.Fatalf("blank name: %d %s", w.Code, w.Body)
	}
	longGoal := strings.Repeat("あ", 2001)
	if utf8.RuneCountInString(longGoal) != 2001 {
		t.Fatal("fixture")
	}
	if w := request(h, "POST", "/api/sprints", `{"name":"g","goal":"`+longGoal+`","startDate":"2026-11-21","endDate":"2026-12-04"}`); w.Code != 400 {
		t.Fatalf("goal 2001: %d %s", w.Code, w.Body)
	}
	for _, body := range []string{
		`{"name":"x","startDate":"2026-13-01","endDate":"2026-12-04"}`,
		`{"name":"x","startDate":"2026-11-21","endDate":"2026-11-20"}`,
		`{"name":"x","startDate":"2026-02-31","endDate":"2026-03-01"}`,
		`{"name":"x","startDate":"2026-11-21","endDate":"2026-12-04","extra":1}`,
	} {
		if w := request(h, "POST", "/api/sprints", body); w.Code != 400 {
			t.Fatalf("%s -> %d", body, w.Code)
		}
	}
}

func TestSprintListOrderAndItemCountACL(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	hash, _ := HashPassword("x")
	repo.users = append(repo.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	repo.sessions[sess.ID] = sess

	a := createSprintOK(t, h, `{"name":"old","startDate":"2026-01-01","endDate":"2026-01-14"}`)
	b := createSprintOK(t, h, `{"name":"new","startDate":"2026-02-01","endDate":"2026-02-14"}`)
	c := createSprintOK(t, h, `{"name":"same-day-later","startDate":"2026-02-01","endDate":"2026-02-14"}`)
	_ = a

	open, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "open", Description: "d"})
	secret, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	repo.cards[secret.ID] = secret
	repo.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}

	if w := request(h, "PUT", "/api/sprints/"+itoa(b.ID)+"/items", `{"itemIds":[`+itoa(open.ID)+`,`+itoa(secret.ID)+`]}`); w.Code != 200 {
		t.Fatalf("put items as admin: %d %s", w.Code, w.Body)
	}

	w := requestWithCookie(h, "GET", "/api/sprints", "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	var list struct {
		Sprints []Sprint `json:"sprints"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Sprints) != 3 {
		t.Fatalf("len=%d", len(list.Sprints))
	}
	// start_date DESC, same day id DESC: c, b, a
	if list.Sprints[0].ID != c.ID || list.Sprints[1].ID != b.ID || list.Sprints[2].ID != a.ID {
		t.Fatalf("order: %+v", list.Sprints)
	}
	var bSummary Sprint
	for _, s := range list.Sprints {
		if s.ID == b.ID {
			bSummary = s
		}
	}
	if bSummary.ItemCount != 1 {
		t.Fatalf("member itemCount must exclude !CanView: got %d", bSummary.ItemCount)
	}
}

func TestSprintGetPatchDeleteAndPathID(t *testing.T) {
	h := NewHandler(fresh())
	s := createSprintOK(t, h, `{"name":"S","goal":"g","startDate":"2026-11-21","endDate":"2026-12-04"}`)
	w := request(h, "GET", "/api/sprints/"+itoa(s.ID), "")
	if w.Code != 200 {
		t.Fatalf("get: %d", w.Code)
	}
	var got Sprint
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.Goal != "g" || got.SuggestedVelocity != 0 || got.Items == nil {
		t.Fatalf("detail: %+v", got)
	}
	w = request(h, "PATCH", "/api/sprints/"+itoa(s.ID), `{"goal":"g2","endDate":"2026-12-10"}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d %s", w.Code, w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.Goal != "g2" || got.EndDate != "2026-12-10" {
		t.Fatalf("patched: %+v", got)
	}
	if w = request(h, "DELETE", "/api/sprints/"+itoa(s.ID), ""); w.Code != 204 {
		t.Fatalf("delete planned: %d", w.Code)
	}

	done := createSprintOK(t, h, `{"name":"done","startDate":"2026-01-01","endDate":"2026-01-07"}`)
	if w = request(h, "POST", "/api/sprints/"+itoa(done.ID)+"/activate", ""); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(h, "POST", "/api/sprints/"+itoa(done.ID)+"/complete", `{}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(h, "DELETE", "/api/sprints/"+itoa(done.ID), ""); w.Code != 409 {
		t.Fatalf("delete completed: %d", w.Code)
	}

	for _, path := range []string{"/api/sprints/no", "/api/sprints/0", "/api/sprints/-1", "/api/sprints/999999999999999999999"} {
		if w = request(h, "GET", path, ""); w.Code != 400 {
			t.Fatalf("%s -> %d", path, w.Code)
		}
	}
}

func TestSprintActivateCompleteVelocity(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	s := createSprintOK(t, h, `{"name":"A","startDate":"2026-11-01","endDate":"2026-11-14"}`)
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{}`); w.Code != 409 {
		t.Fatalf("complete planned: %d", w.Code)
	}
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/activate", ""); w.Code != 200 {
		t.Fatalf("activate: %d %s", w.Code, w.Body)
	}
	other := createSprintOK(t, h, `{"name":"B","startDate":"2026-12-01","endDate":"2026-12-14"}`)
	if w := request(h, "POST", "/api/sprints/"+itoa(other.ID)+"/activate", ""); w.Code != 409 {
		t.Fatalf("second active: %d", w.Code)
	}
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/activate", ""); w.Code != 409 {
		t.Fatalf("re-activate active: %d", w.Code)
	}

	if w := request(h, "PATCH", "/api/sprints/"+itoa(s.ID), `{"velocity":1}`); w.Code != 400 {
		t.Fatalf("velocity on active: %d", w.Code)
	}
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{"velocity":-1}`); w.Code != 400 {
		t.Fatalf("neg velocity: %d", w.Code)
	}
	if w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{"velocity":1.5}`); w.Code != 400 {
		t.Fatalf("non-int velocity: %d", w.Code)
	}
	w := request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{"velocity":3}`)
	if w.Code != 200 {
		t.Fatalf("complete: %d %s", w.Code, w.Body)
	}
	var completed Sprint
	_ = json.Unmarshal(w.Body.Bytes(), &completed)
	if completed.Status != SprintStatusCompleted || completed.Velocity == nil || *completed.Velocity != 3 {
		t.Fatalf("completed: %+v", completed)
	}
	if w = request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/activate", ""); w.Code != 409 {
		t.Fatalf("activate completed: %d", w.Code)
	}

	kept := *completed.Velocity
	if w = request(h, "PATCH", "/api/sprints/"+itoa(s.ID), `{"goal":"x"}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &completed)
	if completed.Velocity == nil || *completed.Velocity != kept {
		t.Fatalf("omit velocity should keep: %+v", completed)
	}
	if w = request(h, "PATCH", "/api/sprints/"+itoa(s.ID), `{"velocity":7}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &completed)
	if completed.Velocity == nil || *completed.Velocity != 7 {
		t.Fatalf("set velocity: %+v", completed)
	}
	if w = request(h, "PATCH", "/api/sprints/"+itoa(s.ID), `{"velocity":null}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &completed)
	if completed.Velocity != nil {
		t.Fatalf("clear velocity: %+v", completed)
	}
}

func TestSprintReplaceItemsOrderACLAndConflicts(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	hash, _ := HashPassword("x")
	repo.users = append(repo.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	repo.sessions[sess.ID] = sess

	proj2 := request(h, "POST", "/api/projects", `{"name":"other"}`)
	var other Project
	_ = json.Unmarshal(proj2.Body.Bytes(), &other)

	s := createSprintOK(t, h, `{"name":"S","startDate":"2026-11-01","endDate":"2026-11-14"}`)
	a, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "a", Description: "d"})
	b, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "b-done", Description: "d"}) // Done
	c, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "c", Description: "d"})
	foreign, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "f", Description: "d", ProjectID: &other.ID})
	secret, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	repo.cards[secret.ID] = secret
	repo.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}

	// Seed members as admin: secret, a, b (positions 0,1,2)
	if w := request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(secret.ID)+`,`+itoa(a.ID)+`,`+itoa(b.ID)+`]}`); w.Code != 200 {
		t.Fatalf("seed: %d %s", w.Code, w.Body)
	}

	// Member PUT visible set [b,a] — retain secret at end in previous relative order
	w := requestWithCookie(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items",
		`{"itemIds":[`+itoa(b.ID)+`,`+itoa(a.ID)+`]}`, sess.ID)
	if w.Code != 200 {
		t.Fatalf("member put: %d %s", w.Code, w.Body)
	}
	// Admin GET sees all: b, a, secret
	w = request(h, "GET", "/api/sprints/"+itoa(s.ID), "")
	var detail Sprint
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if len(detail.Items) != 3 || detail.Items[0].ID != b.ID || detail.Items[1].ID != a.ID || detail.Items[2].ID != secret.ID {
		t.Fatalf("order visible then retain: %+v", detail.Items)
	}
	if detail.SuggestedVelocity != 1 {
		t.Fatalf("suggestedVelocity Done only: %d", detail.SuggestedVelocity)
	}

	if w = request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(foreign.ID)+`]}`); w.Code != 400 {
		t.Fatalf("foreign project: %d", w.Code)
	}
	if w = request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[99999]}`); w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
	_ = request(h, "DELETE", "/api/items/"+itoa(c.ID), "")
	if w = request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(c.ID)+`]}`); w.Code != 404 {
		t.Fatalf("trashed: %d", w.Code)
	}

	s2 := createSprintOK(t, h, `{"name":"S2","startDate":"2026-12-01","endDate":"2026-12-14"}`)
	if w = request(h, "PUT", "/api/sprints/"+itoa(s2.ID)+"/items", `{"itemIds":[`+itoa(a.ID)+`]}`); w.Code != 409 {
		t.Fatalf("dup unfinished: %d %s", w.Code, w.Body)
	}

	// edit-restricted for member
	editOnly, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "edit-lock", Description: "d"})
	editOnly.EditAccess = EditAccessRestricted
	repo.cards[editOnly.ID] = editOnly
	repo.aclEntries[editOnly.ID] = ItemACL{EditUserIDs: []int64{1}}
	if w = requestWithCookie(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items",
		`{"itemIds":[`+itoa(editOnly.ID)+`]}`, sess.ID); w.Code != 403 {
		t.Fatalf("edit denied: %d %s", w.Code, w.Body)
	}

	if w = request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/activate", ""); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(h, "POST", "/api/sprints/"+itoa(s.ID)+"/complete", `{}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[]}`); w.Code != 409 {
		t.Fatalf("put completed: %d", w.Code)
	}
}

func TestSprintSuggestedVelocityCloseExcluded(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	repo.columns = append(repo.columns, Column{ID: 4, Name: "Close", Position: 3})
	s := createSprintOK(t, h, `{"name":"S","startDate":"2026-11-01","endDate":"2026-11-14"}`)
	doneItem, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "done", Description: "d"})
	closeItem, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 4, Title: "close", Description: "d"})
	if w := request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(doneItem.ID)+`,`+itoa(closeItem.ID)+`]}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	w := request(h, "GET", "/api/sprints/"+itoa(s.ID), "")
	var detail Sprint
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if detail.SuggestedVelocity != 1 {
		t.Fatalf("Close must not count: %d items=%+v", detail.SuggestedVelocity, detail.Items)
	}

	// Rename Done away → 0
	repo.columns[2].Name = "Finished"
	w = request(h, "GET", "/api/sprints/"+itoa(s.ID), "")
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if detail.SuggestedVelocity != 0 {
		t.Fatalf("no Done column: %d", detail.SuggestedVelocity)
	}
}

func TestSprintSoftDeleteAndProjectMoveClearMembers(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	s := createSprintOK(t, h, `{"name":"S","startDate":"2026-11-01","endDate":"2026-11-14"}`)
	item, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "x", Description: "d"})
	if w := request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(item.ID)+`]}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := request(h, "DELETE", "/api/items/"+itoa(item.ID), ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if len(repo.sprintItems[s.ID]) != 0 {
		t.Fatalf("soft delete must clear sprint_items: %v", repo.sprintItems[s.ID])
	}

	item2, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "y", Description: "d"})
	if w := request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+itoa(item2.ID)+`]}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	other := request(h, "POST", "/api/projects", `{"name":"p2"}`)
	var p2 Project
	_ = json.Unmarshal(other.Body.Bytes(), &p2)
	if w := request(h, "PATCH", "/api/items/"+itoa(item2.ID), `{"projectId":`+itoa(p2.ID)+`}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if len(repo.sprintItems[s.ID]) != 0 {
		t.Fatalf("project move must clear sprint_items: %v", repo.sprintItems[s.ID])
	}
}

func TestSuggestedVelocityPure(t *testing.T) {
	cols := []Column{{ID: 1, Name: "Todo"}, {ID: 3, Name: "Done"}, {ID: 2, Name: "Close"}}
	items := []SprintItem{
		{ID: 1, ColumnID: 3},
		{ID: 2, ColumnID: 1},
		{ID: 3, ColumnID: 3},
		{ID: 4, ColumnID: 2},
	}
	if n := suggestedVelocity(cols, items); n != 2 {
		t.Fatalf("got %d want 2", n)
	}
	if n := suggestedVelocity([]Column{{ID: 1, Name: "Todo"}}, items); n != 0 {
		t.Fatalf("no Done: got %d", n)
	}
}

func TestBuildFinalSprintItemIDs(t *testing.T) {
	prev := []int64{10, 20, 30, 40}
	visible := []int64{40, 20}
	retain := []int64{10, 30}
	got, err := buildFinalSprintItemIDs(prev, visible, retain)
	if err != nil {
		t.Fatal(err)
	}
	want := []int64{40, 20, 10, 30}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	if _, err := buildFinalSprintItemIDs(prev, []int64{0}, nil); err == nil {
		t.Fatal("expected ErrSprint for non-positive visible id")
	}
}

func TestParseSprintVelocityJSON(t *testing.T) {
	v, err := parseSprintVelocityJSON(json.RawMessage(`42`))
	if err != nil || v != 42 {
		t.Fatalf("got %v err=%v", v, err)
	}
	if _, err := parseSprintVelocityJSON(json.RawMessage(`-1`)); err == nil {
		t.Fatal("expected error for negative")
	}
	if _, err := parseSprintVelocityJSON(json.RawMessage(`1.5`)); err == nil {
		t.Fatal("expected error for non-integer")
	}
}

func TestValidateReplaceSprintItemIDs(t *testing.T) {
	if err := validateReplaceSprintItemIDs([]int64{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if err := validateReplaceSprintItemIDs([]int64{1, 1}); err == nil || !errors.Is(err, ErrSprint) {
		t.Fatalf("expected ErrSprint for duplicate: %v", err)
	}
	if err := validateReplaceSprintItemIDs([]int64{0}); err == nil || !errors.Is(err, ErrSprint) {
		t.Fatalf("expected ErrSprint for non-positive: %v", err)
	}
}

func TestSprintScopedProjectMismatch404(t *testing.T) {
	h := NewHandler(fresh())
	inProject := createSprintOK(t, h, `{"name":"main","startDate":"2026-11-01","endDate":"2026-11-14"}`)
	otherProj := request(h, "POST", "/api/projects", `{"name":"other"}`)
	var p2 Project
	_ = json.Unmarshal(otherProj.Body.Bytes(), &p2)
	foreign := createSprintOK(t, h, `{"name":"foreign","startDate":"2026-11-15","endDate":"2026-11-28","projectId":`+itoa(p2.ID)+`}`)

	// Omitted ?projectId= keeps id-only access.
	if w := request(h, "GET", "/api/sprints/"+itoa(foreign.ID), ""); w.Code != 200 {
		t.Fatalf("get without scope: %d", w.Code)
	}

	wrong := "?projectId=" + itoa(p2.ID)
	for _, route := range []string{
		"/api/sprints/" + itoa(inProject.ID) + wrong,
	} {
		if w := request(h, "GET", route, ""); w.Code != 404 {
			t.Fatalf("GET %s -> %d", route, w.Code)
		}
	}
	mismatchRoutes := []struct {
		method, path, body string
		want               int
	}{
		{"PATCH", "/api/sprints/" + itoa(inProject.ID) + wrong, `{"goal":"x"}`, 404},
		{"DELETE", "/api/sprints/" + itoa(inProject.ID) + wrong, "", 404},
		{"PUT", "/api/sprints/" + itoa(inProject.ID) + "/items" + wrong, `{"itemIds":[]}`, 404},
		{"POST", "/api/sprints/" + itoa(inProject.ID) + "/activate" + wrong, "", 404},
		{"POST", "/api/sprints/" + itoa(inProject.ID) + "/complete" + wrong, `{}`, 404},
	}
	for _, tc := range mismatchRoutes {
		if w := request(h, tc.method, tc.path, tc.body); w.Code != tc.want {
			t.Fatalf("%s %s -> %d", tc.method, tc.path, w.Code)
		}
	}
}

func TestDeleteProjectBlockedBySprints(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	other := request(h, "POST", "/api/projects", `{"name":"spare"}`)
	var p Project
	_ = json.Unmarshal(other.Body.Bytes(), &p)
	createSprintOK(t, h, `{"name":"S","startDate":"2026-11-01","endDate":"2026-11-14","projectId":`+itoa(p.ID)+`}`)
	if w := request(h, "DELETE", "/api/projects/"+itoa(p.ID), ""); w.Code != 409 {
		t.Fatalf("delete project with sprints: %d %s", w.Code, w.Body)
	}
}

package kanban

import (
	"encoding/json"
	"net/http/httptest"
	"slices"
	"testing"
	"time"
)

// The trash list reads only: expired rows are hidden but left to the purge job, and the viewer
// filter works from the ACL state the list query returns (#130).

func TestFilterTrashForViewer(t *testing.T) {
	creator := int64(5)
	member := &User{ID: 7, Role: RoleMember}
	creatorUser := &User{ID: 5, Role: RoleMember}
	outsider := &User{ID: 8, Role: RoleMember}
	editor := &User{ID: 9, Role: RoleMember}
	disabled := &User{ID: 7, Role: RoleMember, Disabled: true}
	admin := &User{ID: 1, Role: RoleAdmin}
	entry := func(id int64, state ItemACLState) TrashEntry {
		return TrashEntry{TrashItem: TrashItem{ID: id}, ACL: state}
	}
	entries := []TrashEntry{
		entry(1, ItemACLState{ViewAccess: ViewAccessPublic}),
		entry(2, ItemACLState{ViewAccess: ViewAccessOpen}),
		entry(3, ItemACLState{ViewAccess: ViewAccessRestricted, CreatedByUserID: &creator, ViewUserIDs: []int64{7}}),
		entry(4, ItemACLState{}), // an empty policy is the default (open)
		entry(5, ItemACLState{ViewAccess: ViewAccessRestricted, EditUserIDs: []int64{9}}), // visible through the edit allowlist
		entry(6, ItemACLState{ViewAccess: "bogus"}),                                       // an invalid policy is hidden
		entry(7, ItemACLState{ViewAccess: ViewAccessOpen, EditAccess: EditAccessRestricted, EditUserIDs: []int64{7}}),
	}
	for _, tc := range []struct {
		name string
		user *User
		want []int64
	}{
		{"anonymous sees only public", nil, []int64{1}},
		{"a listed member", member, []int64{1, 2, 3, 4, 7}},
		{"an outsider", outsider, []int64{1, 2, 4, 7}},
		{"the creator sees theirs without being on the allowlist", creatorUser, []int64{1, 2, 3, 4, 7}},
		{"an editor on the edit allowlist", editor, []int64{1, 2, 4, 5, 7}},
		{"a disabled user sees only public", disabled, []int64{1}},
		{"an admin sees all valid ones", admin, []int64{1, 2, 3, 4, 5, 7}},
	} {
		got := []int64{}
		for _, it := range filterTrashForViewer(entries, tc.user) {
			got = append(got, it.ID)
		}
		if !slices.Equal(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestTrashListHidesExpiredItemsWithoutPurgingThem(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	now := time.Now().UTC()
	expired := now.Add(-trashRetention - time.Hour)
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "fresh", DeletedAt: &now}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, ProjectID: 1, Title: "expired", DeletedAt: &expired}
	w := request(h, "GET", "/api/trash?projectId=1", "")
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	var listed struct {
		Items []TrashItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Items) != 1 || listed.Items[0].ID != 1 {
		t.Fatalf("list = %+v; want only the fresh item", listed.Items)
	}
	if _, ok := repo.cards[2]; !ok {
		t.Fatal("listing must not purge: the expired row is left to /api/trash/purge")
	}
}

// The handler passes the signed-in user to the viewer filter: a member sees the open row, not a
// restricted one they are not on; the admin sees both; the list needs a session.
func TestTrashListFiltersByTheSignedInUser(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	now := time.Now().UTC()
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "open", ViewAccess: ViewAccessOpen, DeletedAt: &now}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, ProjectID: 1, Title: "restricted", ViewAccess: ViewAccessRestricted, DeletedAt: &now}
	member, err := repo.CreateUser(t.Context(), UserCreateInput{LoginName: "trash-member", Password: "password1", DisplayName: "Member", Role: RoleMember})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(t.Context(), member.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	titles := func(rec *httptest.ResponseRecorder) []string {
		t.Helper()
		if rec.Code != 200 {
			t.Fatalf("list: %d %s", rec.Code, rec.Body)
		}
		var listed struct {
			Items []TrashItem `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, it := range listed.Items {
			out = append(out, it.Title)
		}
		slices.Sort(out)
		return out
	}
	if got := titles(requestWithCookie(h, "GET", "/api/trash?projectId=1", "", sess.ID)); !slices.Equal(got, []string{"open"}) {
		t.Fatalf("member sees %v; want only the open row", got)
	}
	if got := titles(request(h, "GET", "/api/trash?projectId=1", "")); !slices.Equal(got, []string{"open", "restricted"}) {
		t.Fatalf("admin sees %v; want both", got)
	}
	if rec := requestAnon(h, "GET", "/api/trash?projectId=1", ""); rec.Code != 401 {
		t.Fatalf("anonymous list = %d; want 401", rec.Code)
	}
}

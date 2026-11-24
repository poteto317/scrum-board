package kanban

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// sprintBatchFixture builds `sprints` sprints with `itemsPer` items each, every second item
// restricted (so the ACL entries have to be read). It returns the repository, the handler and
// the session id of a member who can see only the open items.
func sprintBatchFixture(t *testing.T, sprints, itemsPer int) (*memoryRepo, http.Handler, string, []int64) {
	t.Helper()
	repo := fresh()
	h := NewHandler(repo)
	hash, _ := HashPassword("x")
	repo.users = append(repo.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	repo.sessions[sess.ID] = sess
	var sprintIDs []int64
	for i := 0; i < sprints; i++ {
		month := itoa(int64(i%9 + 1))
		s := createSprintOK(t, h, `{"name":"s`+itoa(int64(i))+`","startDate":"2026-0`+month+`-01","endDate":"2026-0`+month+`-14"}`)
		ids := ""
		for j := 0; j < itemsPer; j++ {
			it, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "i", Description: "d"})
			if j%2 == 1 {
				it.ViewAccess = ViewAccessRestricted
				it.EditAccess = EditAccessRestricted
				repo.cards[it.ID] = it
				repo.aclEntries[it.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}
			}
			if ids != "" {
				ids += ","
			}
			ids += itoa(it.ID)
		}
		if w := request(h, "PUT", "/api/sprints/"+itoa(s.ID)+"/items", `{"itemIds":[`+ids+`]}`); w.Code != 200 {
			t.Fatalf("put items: %d %s", w.Code, w.Body)
		}
		sprintIDs = append(sprintIDs, s.ID)
	}
	return repo, h, sess.ID, sprintIDs
}

func TestSprintListReadsItemsInOneGoWhateverTheSize(t *testing.T) {
	small, hs, sessS, _ := sprintBatchFixture(t, 1, 2)
	large, hl, sessL, _ := sprintBatchFixture(t, 5, 6)
	count := func(repo *memoryRepo, h http.Handler, sess string) (int64, int64) {
		items, acl := repo.getItemCalls.Load(), repo.aclListCalls.Load()
		if w := requestWithCookie(h, "GET", "/api/sprints", "", sess); w.Code != 200 {
			t.Fatalf("list: %d %s", w.Code, w.Body)
		}
		return repo.getItemCalls.Load() - items, repo.aclListCalls.Load() - acl
	}
	gs, as := count(small, hs, sessS)
	gl, al := count(large, hl, sessL)
	if gs != 0 || gl != 0 {
		t.Fatalf("GetItem per member: small %d, large %d (want 0)", gs, gl)
	}
	if as != al || al > 1 {
		t.Fatalf("ACL reads: small %d, large %d (want one, the same for both)", as, al)
	}
}

func TestSprintDetailReadsItemsInOneGoWhateverTheSize(t *testing.T) {
	small, hs, sessS, idsS := sprintBatchFixture(t, 1, 2)
	large, hl, sessL, idsL := sprintBatchFixture(t, 1, 12)
	count := func(repo *memoryRepo, h http.Handler, sess string, id int64) (int64, int64) {
		items, acl := repo.getItemCalls.Load(), repo.aclListCalls.Load()
		if w := requestWithCookie(h, "GET", "/api/sprints/"+itoa(id), "", sess); w.Code != 200 {
			t.Fatalf("detail: %d %s", w.Code, w.Body)
		}
		return repo.getItemCalls.Load() - items, repo.aclListCalls.Load() - acl
	}
	gs, as := count(small, hs, sessS, idsS[0])
	gl, al := count(large, hl, sessL, idsL[0])
	if gs != 0 || gl != 0 {
		t.Fatalf("GetItem per member: small %d, large %d (want 0)", gs, gl)
	}
	if as != al || al > 1 {
		t.Fatalf("ACL reads: small %d, large %d (want one, the same for both)", as, al)
	}
}

// What the response says, not only how it was read: a member sees the open items, an admin all.
func TestSprintListAndDetailCountOnlyWhatTheViewerMaySee(t *testing.T) {
	_, h, sess, ids := sprintBatchFixture(t, 2, 4) // per sprint: 2 open, 2 restricted
	var list struct {
		Sprints []Sprint `json:"sprints"`
	}
	w := requestWithCookie(h, "GET", "/api/sprints", "", sess)
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || w.Code != 200 {
		t.Fatalf("list %d %s %v", w.Code, w.Body, err)
	}
	if len(list.Sprints) != 2 {
		t.Fatalf("sprints %+v", list.Sprints)
	}
	for _, s := range list.Sprints {
		if s.ItemCount != 2 || len(s.Items) != 0 {
			t.Fatalf("member's list: itemCount %d, items %d (want 2 visible, no items)", s.ItemCount, len(s.Items))
		}
	}
	var detail Sprint
	w = requestWithCookie(h, "GET", "/api/sprints/"+itoa(ids[0]), "", sess)
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil || w.Code != 200 {
		t.Fatalf("detail %d %s %v", w.Code, w.Body, err)
	}
	if detail.ItemCount != 2 || len(detail.Items) != 2 {
		t.Fatalf("member's detail: itemCount %d, items %d", detail.ItemCount, len(detail.Items))
	}
	w = request(h, "GET", "/api/sprints/"+itoa(ids[0]), "")
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil || w.Code != 200 {
		t.Fatalf("admin detail %d %s %v", w.Code, w.Body, err)
	}
	if detail.ItemCount != 4 || len(detail.Items) != 4 {
		t.Fatalf("admin's detail: itemCount %d, items %d (want all 4)", detail.ItemCount, len(detail.Items))
	}
	for name, body := range map[string]string{
		"admin's detail": w.Body.String(),
		"member's list":  requestWithCookie(h, "GET", "/api/sprints", "", sess).Body.String(),
		"admin's list":   request(h, "GET", "/api/sprints", "").Body.String(),
	} {
		for _, column := range []string{"viewAccess", "editAccess", "createdByUserId"} {
			if strings.Contains(body, column) {
				t.Fatalf("%s: %s must not reach the response: %s", name, column, body)
			}
		}
	}
}

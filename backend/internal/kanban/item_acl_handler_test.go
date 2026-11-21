package kanban

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestItemACLPublicAnonymousGet(t *testing.T) {
	m := fresh()
	card, err := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "pub", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	card.ViewAccess = ViewAccessPublic
	m.cards[card.ID] = card
	h := NewHandler(m)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/items/"+strconv.FormatInt(card.ID, 10), nil)
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("public get: %d %s", w.Code, w.Body)
	}
	var got Item
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ViewerCanEdit || got.ViewerCanManage {
		t.Fatalf("anonymous public get must not set canEdit/canManage")
	}
	if got.ACL != nil {
		t.Fatal("anonymous public must not include acl")
	}
}

func TestItemACLRestrictedHidesFromBoard(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	open, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "open", Description: "d"})
	secret, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[secret.ID] = secret
	m.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}} // only admin

	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)
	w := requestWithCookie(h, "GET", "/api/board", "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("board: %d", w.Code)
	}
	var b Board
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	for _, it := range b.Items {
		if it.ID == secret.ID {
			t.Fatal("restricted item leaked to board")
		}
		if it.ID == open.ID {
			return
		}
	}
	t.Fatal("open item missing")
}

func TestItemACLPatchRequiresManage(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	card, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "c", Description: "d"})
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)
	body := `{"viewAccess":"restricted","editAccess":"restricted","viewUserIds":[2],"editUserIds":[2]}`
	path := "/api/items/" + strconv.FormatInt(card.ID, 10) + "/acl"
	w := requestWithCookie(h, "PATCH", path, body, sess.ID)
	if w.Code != 403 {
		t.Fatalf("member acl patch: %d %s", w.Code, w.Body)
	}
	w = requestWithCookie(h, "PATCH", path, body, HandlerTestSessionID)
	if w.Code != 200 {
		t.Fatalf("admin acl patch: %d %s", w.Code, w.Body)
	}
}

func TestGeneralPatchRejectsACLFields(t *testing.T) {
	m := fresh()
	card, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "c", Description: "d"})
	h := NewHandler(m)
	w := request(h, "PATCH", "/api/items/"+strconv.FormatInt(card.ID, 10), `{"viewAccess":"public"}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "アクセス設定") {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
}

func TestItemACLRestrictedHistoryAndCommandsForbidden(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	card, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	card.ViewAccess = ViewAccessRestricted
	card.EditAccess = EditAccessRestricted
	m.cards[card.ID] = card
	m.aclEntries[card.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)
	num := strconv.FormatInt(card.Number, 10)
	w := requestWithCookie(h, "GET", "/api/items/by-number/"+num+"/history?projectId=1", "", sess.ID)
	if w.Code != 403 || !strings.Contains(w.Body.String(), msgViewForbidden) {
		t.Fatalf("history: %d %s", w.Code, w.Body)
	}
	w = requestWithCookie(h, "GET", "/api/items/by-number/"+num+"/command-templates?projectId=1", "", sess.ID)
	if w.Code != 403 || !strings.Contains(w.Body.String(), msgViewForbidden) {
		t.Fatalf("list commands: %d %s", w.Code, w.Body)
	}
	w = requestWithCookie(h, "PUT", "/api/items/by-number/"+num+"/command-templates?projectId=1", `{"templateIds":[]}`, sess.ID)
	if w.Code != 403 {
		t.Fatalf("replace commands: %d %s", w.Code, w.Body)
	}
}

func TestMergeHiddenIntoOrder(t *testing.T) {
	hidden := map[int64]struct{}{2: {}}
	got := mergeHiddenIntoOrder([]int64{1, 2, 3}, []int64{3, 1}, hidden)
	want := []int64{3, 2, 1}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func TestItemACLFiltersRelatedPeers(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	visible, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "vis", Description: "d"})
	secret, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret-peer", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[secret.ID] = secret
	m.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}}
	visible.RelatedItems = []RelatedItem{
		{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title},
	}
	m.cards[visible.ID] = visible
	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)
	w := requestWithCookie(h, "GET", "/api/items/"+strconv.FormatInt(visible.ID, 10), "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("get: %d %s", w.Code, w.Body)
	}
	var got Item
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	for _, rel := range got.RelatedItems {
		if rel.Number == secret.Number {
			t.Fatal("restricted related peer leaked")
		}
	}
}

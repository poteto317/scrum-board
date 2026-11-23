package kanban

import (
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"
)

func TestArchiveListFiltersByViewACL(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	open, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "open archived", Description: "d"})
	secret, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "secret archived", Description: "d"})
	now := time.Now().UTC()
	open.ArchivedAt = &now
	secret.ArchivedAt = &now
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[open.ID] = open
	m.cards[secret.ID] = secret
	m.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}}

	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)

	w := requestWithCookie(h, "GET", "/api/archive?projectId=1", "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("archive list: %d %s", w.Code, w.Body)
	}
	var body struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, it := range body.Items {
		if it.ID == secret.ID {
			t.Fatal("restricted archived item leaked")
		}
	}
	found := false
	for _, it := range body.Items {
		if it.ID == open.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("open archived item missing")
	}
}

func TestUnarchiveNotFoundAndACL(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	active, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "active", Description: "d"})
	archived, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "archived", Description: "d"})
	now := time.Now().UTC()
	archived.ArchivedAt = &now
	archived.ViewAccess = ViewAccessRestricted
	archived.EditAccess = EditAccessRestricted
	m.cards[archived.ID] = archived
	m.aclEntries[archived.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}

	sess := Session{ID: "mem-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)

	w := requestWithCookie(h, "POST", fmt.Sprintf("/api/items/%d/unarchive?projectId=1", active.ID), "", HandlerTestSessionID)
	if w.Code != 404 {
		t.Fatalf("unarchive active: %d %s", w.Code, w.Body)
	}
	w = requestWithCookie(h, "POST", fmt.Sprintf("/api/items/%d/unarchive?projectId=1", archived.ID), "", sess.ID)
	if w.Code != 403 {
		t.Fatalf("unarchive without edit ACL: %d %s", w.Code, w.Body)
	}
	w = requestWithCookie(h, "POST", fmt.Sprintf("/api/items/%d/unarchive?projectId=1", archived.ID), "", HandlerTestSessionID)
	if w.Code != 200 {
		t.Fatalf("admin unarchive: %d %s", w.Code, w.Body)
	}
	got, err := m.GetItem(t.Context(), archived.ID)
	if err != nil || got.ArchivedAt != nil || got.DoneAt == nil {
		t.Fatalf("restored = %+v err=%v", got, err)
	}
}

func TestArchivedItemWriteReturns409(t *testing.T) {
	m := fresh()
	card, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "archived", Description: "d"})
	now := time.Now().UTC()
	card.ArchivedAt = &now
	m.cards[card.ID] = card
	h := NewHandler(m)
	path := "/api/items/" + strconv.FormatInt(card.ID, 10)
	w := request(h, "PATCH", path, `{"title":"nope"}`)
	if w.Code != 409 {
		t.Fatalf("patch archived: %d %s", w.Code, w.Body)
	}
}

func TestArchiveDoneItemsBatchesOver100(t *testing.T) {
	m := fresh()
	cutoff := time.Now().UTC().Add(-archiveAfterDone - time.Minute)
	const n = archiveBatchSize + 1
	for i := 0; i < n; i++ {
		item, err := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: fmt.Sprintf("due-%d", i), Description: "d"})
		if err != nil {
			t.Fatal(err)
		}
		item.DoneAt = &cutoff
		m.cards[item.ID] = item
	}
	young, err := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "young", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	youngDone := time.Now().UTC().Add(-time.Hour)
	young.DoneAt = &youngDone
	m.cards[young.ID] = young

	archived, err := m.ArchiveDoneItems(t.Context())
	if err != nil || archived != n {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want %d", archived, err, n)
	}
	listed, err := m.ListArchivedItems(t.Context(), 1)
	if err != nil || len(listed) != n {
		t.Fatalf("ListArchivedItems len=%d err=%v; want %d", len(listed), err, n)
	}
	if got, _ := m.GetItem(t.Context(), young.ID); got.ArchivedAt != nil {
		t.Fatal("young item should not be archived")
	}
}

func TestArchiveSkipsNilDoneAt(t *testing.T) {
	m := fresh()
	oldDone := time.Now().UTC().Add(-archiveAfterDone - time.Minute)
	unknown, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "unknown", Description: "d"})
	unknown.DoneAt = nil
	m.cards[unknown.ID] = unknown
	due, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 3, Title: "due", Description: "d"})
	due.DoneAt = &oldDone
	m.cards[due.ID] = due

	archived, err := m.ArchiveDoneItems(t.Context())
	if err != nil || archived != 1 {
		t.Fatalf("ArchiveDoneItems() = %d, %v; want 1", archived, err)
	}
	if got, _ := m.GetItem(t.Context(), unknown.ID); got.ArchivedAt != nil {
		t.Fatal("nil done_at must not be archived")
	}
	if got, _ := m.GetItem(t.Context(), due.ID); got.ArchivedAt == nil {
		t.Fatal("due item must be archived")
	}
}

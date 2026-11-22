package kanban

import (
	"strconv"
	"strings"
	"testing"
)

func TestRelatedPeerAddForbidden(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	h := NewHandler(m)
	beforeHist, _ := m.History(t.Context(), open.Number, 1, 0)
	beforePeer := m.cards[secret.ID]

	body := `{"relatedItems":[{"kind":"item","number":` + strconv.FormatInt(secret.Number, 10) + `,"projectId":1}]}`
	w := requestWithCookie(h, "PATCH", "/api/items/"+strconv.FormatInt(open.ID, 10), body, sess.ID)
	if w.Code != 403 || !strings.Contains(w.Body.String(), msgEditForbidden) {
		t.Fatalf("add: %d %s", w.Code, w.Body)
	}
	gotOpen, _ := m.GetItem(t.Context(), open.ID)
	for _, rel := range gotOpen.RelatedItems {
		if rel.Number == secret.Number {
			t.Fatal("owner related updated on 403")
		}
	}
	gotPeer, _ := m.GetItem(t.Context(), secret.ID)
	for _, rel := range gotPeer.RelatedItems {
		if rel.Number == open.Number {
			t.Fatal("reverse link created on 403")
		}
	}
	afterHist, _ := m.History(t.Context(), open.Number, 1, 0)
	if len(afterHist.Events) != len(beforeHist.Events) {
		t.Fatalf("history changed: before=%d after=%d", len(beforeHist.Events), len(afterHist.Events))
	}
	if gotPeer.UpdatedAt != beforePeer.UpdatedAt {
		t.Fatalf("peer updated_at changed: %v -> %v", beforePeer.UpdatedAt, gotPeer.UpdatedAt)
	}
}

func TestRelatedPeerCreateForbidden(t *testing.T) {
	m, _, secret, _, sess := relatedACLFixture(t)
	h := NewHandler(m)
	before, _ := m.Board(t.Context())
	body := `{"title":"new","description":"d","columnId":1,"relatedItems":[{"kind":"item","number":` +
		strconv.FormatInt(secret.Number, 10) + `,"projectId":1}]}`
	w := requestWithCookie(h, "POST", "/api/items", body, sess.ID)
	if w.Code != 403 || !strings.Contains(w.Body.String(), msgEditForbidden) {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	after, _ := m.Board(t.Context())
	if len(after.Items) != len(before.Items) {
		t.Fatalf("item created on 403: before=%d after=%d", len(before.Items), len(after.Items))
	}
}

func TestRelatedPeerRemoveForbidden(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	open.RelatedItems = []RelatedItem{{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title}}
	m.cards[open.ID] = open
	h := NewHandler(m)
	w := requestWithCookie(h, "PATCH", "/api/items/"+strconv.FormatInt(open.ID, 10), `{"relatedItems":[]}`, sess.ID)
	if w.Code != 403 || !strings.Contains(w.Body.String(), msgEditForbidden) {
		t.Fatalf("remove: %d %s", w.Code, w.Body)
	}
	got, _ := m.GetItem(t.Context(), open.ID)
	if len(got.RelatedItems) != 1 || got.RelatedItems[0].Number != secret.Number {
		t.Fatalf("related cleared on 403: %+v", got.RelatedItems)
	}
}

func TestRelatedPeerPartialReject(t *testing.T) {
	m, open, secret, allowed, sess := relatedACLFixture(t)
	h := NewHandler(m)
	body := `{"relatedItems":[` +
		`{"kind":"item","number":` + strconv.FormatInt(allowed.Number, 10) + `,"projectId":1},` +
		`{"kind":"item","number":` + strconv.FormatInt(secret.Number, 10) + `,"projectId":1}` +
		`]}`
	w := requestWithCookie(h, "PATCH", "/api/items/"+strconv.FormatInt(open.ID, 10), body, sess.ID)
	if w.Code != 403 {
		t.Fatalf("partial update: %d %s", w.Code, w.Body)
	}
	gotAllowed, _ := m.GetItem(t.Context(), allowed.ID)
	for _, rel := range gotAllowed.RelatedItems {
		if rel.Number == open.Number {
			t.Fatal("allowed peer got reverse link on partial reject")
		}
	}
	createBody := `{"title":"partial","description":"d","columnId":1,"relatedItems":[` +
		`{"kind":"item","number":` + strconv.FormatInt(allowed.Number, 10) + `,"projectId":1},` +
		`{"kind":"item","number":` + strconv.FormatInt(secret.Number, 10) + `,"projectId":1}` +
		`]}`
	before, _ := m.Board(t.Context())
	w = requestWithCookie(h, "POST", "/api/items", createBody, sess.ID)
	if w.Code != 403 {
		t.Fatalf("partial create: %d %s", w.Code, w.Body)
	}
	after, _ := m.Board(t.Context())
	if len(after.Items) != len(before.Items) {
		t.Fatal("create succeeded on partial reject")
	}
}

func TestRelatedPeerAddAllowed(t *testing.T) {
	m, open, _, allowed, _ := relatedACLFixture(t)
	h := NewHandler(m)
	body := `{"relatedItems":[{"kind":"item","number":` + strconv.FormatInt(allowed.Number, 10) + `,"projectId":1}]}`
	w := request(h, "PATCH", "/api/items/"+strconv.FormatInt(open.ID, 10), body)
	if w.Code != 200 {
		t.Fatalf("admin add: %d %s", w.Code, w.Body)
	}
	got, _ := m.GetItem(t.Context(), open.ID)
	if len(got.RelatedItems) != 1 || got.RelatedItems[0].Number != allowed.Number {
		t.Fatalf("related not saved: %+v", got.RelatedItems)
	}
}

func TestRelatedPeerAddAllowedForMember(t *testing.T) {
	m, open, _, allowed, sess := relatedACLFixture(t)
	h := NewHandler(m)
	body := `{"relatedItems":[{"kind":"item","number":` + strconv.FormatInt(allowed.Number, 10) + `,"projectId":1}]}`
	w := requestWithCookie(h, "PATCH", "/api/items/"+strconv.FormatInt(open.ID, 10), body, sess.ID)
	if w.Code != 200 {
		t.Fatalf("member add: %d %s", w.Code, w.Body)
	}
	got, _ := m.GetItem(t.Context(), open.ID)
	if len(got.RelatedItems) != 1 || got.RelatedItems[0].Number != allowed.Number {
		t.Fatalf("related not saved: %+v", got.RelatedItems)
	}
}


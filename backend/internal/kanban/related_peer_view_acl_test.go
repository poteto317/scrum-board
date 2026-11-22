package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
)

func TestBoardOmitsRestrictedRelatedTitle(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	open.RelatedItems = []RelatedItem{{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title}}
	m.cards[open.ID] = open
	h := NewHandler(m)

	w := requestWithCookie(h, "GET", "/api/board", "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("board: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("board leaked related title: %s", w.Body)
	}
	var b Board
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	found := false
	for _, it := range b.Items {
		if it.ID == open.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("open missing from board")
	}

	w = requestWithCookie(h, "GET", "/api/backlog", "", sess.ID)
	if w.Code != 200 {
		t.Fatalf("backlog: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("backlog leaked related title: %s", w.Body)
	}

	m.settings.CardLayout = CardLayoutFree
	w = requestWithCookie(h, "PATCH", "/api/board/settings", `{"cardLayout":"pack"}`, sess.ID)
	if w.Code != 200 {
		t.Fatalf("settings: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("settings leaked related title: %s", w.Body)
	}
}

func TestStatusAssigneeOmitsRestrictedRelatedTitle(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	open.RelatedItems = []RelatedItem{{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title}}
	m.cards[open.ID] = open
	h := NewHandler(m)
	num := strconv.FormatInt(open.Number, 10)

	w := requestWithCookie(h, "PATCH", "/api/items/by-number/"+num+"/status?projectId=1", `{"status":"Doing"}`, sess.ID)
	if w.Code != 200 {
		t.Fatalf("status: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("status leaked related title: %s", w.Body)
	}

	w = requestWithCookie(h, "PATCH", "/api/items/by-number/"+num+"/assignee?projectId=1", `{"assignee":"mem"}`, sess.ID)
	if w.Code != 200 {
		t.Fatalf("assignee: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("assignee leaked related title: %s", w.Body)
	}
}

func TestFilterBoardItemsRelatedACLFailureReturns500(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	open.RelatedItems = []RelatedItem{{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title}}
	m.cards[open.ID] = open
	m.aclListFail = errors.New("acl-list-boom")
	h := NewHandler(m)

	for _, tc := range []struct {
		name, method, path, body string
	}{
		{"board", "GET", "/api/board", ""},
		{"backlog", "GET", "/api/backlog", ""},
		{"status", "PATCH", "/api/items/by-number/" + strconv.FormatInt(open.Number, 10) + "/status?projectId=1", `{"status":"Doing"}`},
		{"assignee", "PATCH", "/api/items/by-number/" + strconv.FormatInt(open.Number, 10) + "/assignee?projectId=1", `{"assignee":"mem"}`},
		{"update", "PATCH", "/api/items/" + strconv.FormatInt(open.ID, 10), `{"title":"still-open"}`},
	} {
		w := requestWithCookie(h, tc.method, tc.path, tc.body, sess.ID)
		if w.Code != 500 {
			t.Fatalf("%s: %d want 500 body=%s", tc.name, w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), secretPeerTitle) {
			t.Fatalf("%s leaked title on fail: %s", tc.name, w.Body)
		}
	}
}

type relatedGetByNumberFailRepo struct {
	*memoryRepo
	fail error
}

func (r relatedGetByNumberFailRepo) GetItemByNumber(ctx context.Context, number, projectID int64) (Item, error) {
	if r.fail != nil {
		item, err := r.memoryRepo.GetItemByNumber(ctx, number, projectID)
		if err == nil {
			return Item{}, r.fail
		}
		return item, err
	}
	return r.memoryRepo.GetItemByNumber(ctx, number, projectID)
}

func TestBoardRelatedPeerGetFailureReturns500(t *testing.T) {
	m, open, secret, _, sess := relatedACLFixture(t)
	open.RelatedItems = []RelatedItem{{Kind: relatedKindItem, Number: secret.Number, ProjectID: 1, Title: secret.Title}}
	m.cards[open.ID] = open
	h := NewHandler(relatedGetByNumberFailRepo{memoryRepo: m, fail: errors.New("get-by-number-boom")})
	w := requestWithCookie(h, "GET", "/api/board", "", sess.ID)
	if w.Code != 500 {
		t.Fatalf("board: %d want 500 body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secretPeerTitle) {
		t.Fatalf("leaked title on get failure: %s", w.Body)
	}
}

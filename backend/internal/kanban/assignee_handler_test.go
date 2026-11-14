package kanban

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestChangeAssigneeByNumber(t *testing.T) {
	r := fresh()
	r.cards[22] = Card{
		ID: 22, Number: 7, ColumnID: 1, Title: "keep", Description: "body",
		PRURLs: []string{}, CreatedAt: time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC),
	}
	r.cards[7] = Card{ID: 7, Number: 22, ColumnID: 1, Title: "other", PRURLs: []string{}}
	h := NewHandler(r)

	w := request(h, "PATCH", "/api/cards/by-number/7/assignee", `{"assignee":"cursor"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var got Card
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != 22 || got.Number != 7 || got.Assignee != "Cursor" || got.Title != "keep" {
		t.Fatalf("unexpected card: %+v", got)
	}
	if r.cards[22].Assignee != "Cursor" {
		t.Fatalf("memory not updated: %+v", r.cards[22])
	}
	if r.cards[7].Assignee != "" {
		t.Fatalf("wrong card updated: %+v", r.cards[7])
	}

	w = request(h, "PATCH", "/api/cards/by-number/7/assignee", `{"assignee":""}`)
	if w.Code != http.StatusOK {
		t.Fatalf("clear status %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Assignee != "" {
		t.Fatalf("expected clear, got %q", got.Assignee)
	}
}

func TestChangeAssigneeByNumberValidation(t *testing.T) {
	r := fresh()
	r.cards[1] = Card{ID: 1, Number: 1, ColumnID: 1, Title: "t", PRURLs: []string{}}
	h := NewHandler(r)
	cases := []struct {
		body string
		code int
	}{
		{`{}`, 400},
		{`{"assignee":null}`, 400},
		{`{"assignee":"` + strings.Repeat("x", 61) + `"}`, 400},
		{`{"assignee":"Claude","extra":1}`, 400},
	}
	for _, tc := range cases {
		w := request(h, "PATCH", "/api/cards/by-number/1/assignee", tc.body)
		if w.Code != tc.code {
			t.Fatalf("%s -> %d want %d (%s)", tc.body, w.Code, tc.code, w.Body.String())
		}
	}
	control, err := json.Marshal(map[string]string{"assignee": "a\nb"})
	if err != nil {
		t.Fatal(err)
	}
	w := request(h, "PATCH", "/api/cards/by-number/1/assignee", string(control))
	if w.Code != 400 {
		t.Fatalf("control char -> %d (%s)", w.Code, w.Body.String())
	}
	w = request(h, "PATCH", "/api/cards/by-number/99/assignee", `{"assignee":"Cursor"}`)
	if w.Code != 404 {
		t.Fatalf("missing card -> %d", w.Code)
	}
}

func TestCreateCardAssignee(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "POST", "/api/cards", `{"title":"n","description":"","columnId":1,"assignee":"cursor"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var got Card
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Assignee != "Cursor" {
		t.Fatalf("assignee=%q", got.Assignee)
	}
	control, err := json.Marshal(map[string]any{
		"title": "x", "description": "", "columnId": 1, "assignee": "a\nb",
	})
	if err != nil {
		t.Fatal(err)
	}
	w = request(h, "POST", "/api/cards", string(control))
	if w.Code != 400 {
		t.Fatalf("control -> %d", w.Code)
	}
}

func TestUpdateCardAssigneeByID(t *testing.T) {
	r := fresh()
	r.cards[5] = Card{ID: 5, Number: 9, ColumnID: 1, Title: "t", Description: "d", PRURLs: []string{}}
	h := NewHandler(r)
	w := request(h, "PATCH", "/api/cards/5", `{"assignee":"claude"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var got Card
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Assignee != "Claude" || got.Title != "t" || got.Number != 9 {
		t.Fatalf("unexpected: %+v", got)
	}
	control, err := json.Marshal(map[string]string{"assignee": "x\ny"})
	if err != nil {
		t.Fatal(err)
	}
	w = request(h, "PATCH", "/api/cards/5", string(control))
	if w.Code != 400 {
		t.Fatalf("control char -> %d", w.Code)
	}
	w = request(h, "PATCH", "/api/cards/5", `{"title":"keep","assignee":null}`)
	if w.Code != 400 {
		t.Fatalf("null assignee with title -> %d", w.Code)
	}
	if r.cards[5].Title != "t" || r.cards[5].Assignee != "Claude" {
		t.Fatalf("null assignee must not apply partial update: %+v", r.cards[5])
	}
}

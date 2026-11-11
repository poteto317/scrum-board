package kanban

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type memoryRepo struct {
	columns []Column
	cards   map[int64]Card
	next    int64
}

func fresh() *memoryRepo {
	return &memoryRepo{columns: []Column{{ID: 1, Name: "Todo"}, {ID: 2, Name: "Doing"}, {ID: 3, Name: "Done"}}, cards: map[int64]Card{}, next: 1}
}
func (m *memoryRepo) Board(context.Context) (Board, error) {
	b := Board{Columns: m.columns, Cards: []Card{}}
	for _, c := range m.cards {
		b.Cards = append(b.Cards, c)
	}
	return b, nil
}
func (m *memoryRepo) GetCard(_ context.Context, id int64) (Card, error) {
	c, ok := m.cards[id]
	if !ok {
		return c, ErrNotFound
	}
	return c, nil
}
func (m *memoryRepo) validColumn(id int64) bool {
	for _, c := range m.columns {
		if c.ID == id {
			return true
		}
	}
	return false
}
func (m *memoryRepo) CreateCard(_ context.Context, in CardInput) (Card, error) {
	if !m.validColumn(in.ColumnID) {
		return Card{}, ErrColumn
	}
	c := Card{Number: m.next, ID: m.next, ColumnID: in.ColumnID, Title: in.Title, Description: in.Description}
	m.next++
	m.cards[c.ID] = c
	return c, nil
}
func (m *memoryRepo) UpdateCard(ctx context.Context, id int64, p CardPatch) (Card, error) {
	c, err := m.GetCard(ctx, id)
	if err != nil {
		return c, err
	}
	if p.ColumnID != nil {
		if !m.validColumn(*p.ColumnID) {
			return c, ErrColumn
		}
		c.ColumnID = *p.ColumnID
	}
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	m.cards[id] = c
	return c, nil
}
func (m *memoryRepo) DeleteCard(ctx context.Context, id int64) error {
	if _, err := m.GetCard(ctx, id); err != nil {
		return err
	}
	delete(m.cards, id)
	return nil
}
func (m *memoryRepo) CreateColumn(_ context.Context, name string) (Column, error) {
	for _, c := range m.columns {
		if strings.EqualFold(c.Name, name) {
			return Column{}, ErrDuplicate
		}
	}
	c := Column{ID: int64(len(m.columns) + 1), Name: name, Position: len(m.columns)}
	m.columns = append(m.columns, c)
	return c, nil
}
func request(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(w, r)
	return w
}
func TestValidation(t *testing.T) {
	cases := []struct {
		name, method, path, body string
		status                   int
	}{
		{"blank title", "POST", "/api/cards", `{"title":"　 ","columnId":1}`, 400},
		{"long title", "POST", "/api/cards", `{"title":"` + strings.Repeat("あ", 201) + `","columnId":1}`, 400},
		{"unknown column", "POST", "/api/cards", `{"title":"学習","columnId":99}`, 400},
		{"blank column", "POST", "/api/columns", `{"name":" "}`, 400},
		{"duplicate column", "POST", "/api/columns", `{"name":"Todo"}`, 409},
		{"missing card", "GET", "/api/cards/999", "", 404},
		{"unknown field", "POST", "/api/cards", `{"title":"x","columnId":1,"oops":true}`, 400},
		{"multiple JSON", "POST", "/api/columns", `{"name":"Review"} {}`, 400},
		{"bad id", "GET", "/api/cards/no", "", 400},
		{"empty patch", "PATCH", "/api/cards/1", `{}`, 400},
		{"null patch", "PATCH", "/api/cards/1", `{"title":null}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := request(NewHandler(fresh()), tc.method, tc.path, tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}
func TestCardLifecycleAndPartialUpdate(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "POST", "/api/cards", `{"title":" 日本語の学習 ","description":"AngularとGo","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var c Card
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.Title != "日本語の学習" {
		t.Fatal(c)
	}
	w = request(h, "PATCH", "/api/cards/1", `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.ColumnID != 2 || c.Title != "日本語の学習" || c.Description != "AngularとGo" {
		t.Fatal(c)
	}
	w = request(h, "PATCH", "/api/cards/1", `{"columnId":99}`)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	w = request(h, "GET", "/api/board", "")
	var b Board
	json.Unmarshal(w.Body.Bytes(), &b)
	if w.Code != 200 || len(b.Cards) != 1 || b.Cards[0].ColumnID != 2 {
		t.Fatal(w.Body)
	}
	if w = request(h, "DELETE", "/api/cards/1", ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w = request(h, "GET", "/api/cards/1", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w = request(h, "POST", "/api/columns", `{"name":" レビュー "}`); w.Code != 201 {
		t.Fatal(w.Body)
	}
}

func TestUnicodeValidationBoundaries(t *testing.T) {
	h := NewHandler(fresh())
	payload := `{"columnId":1,"title":"` + strings.Repeat("🧪", 200) + `","description":"` + strings.Repeat("あ", 10000) + `"}`
	if w := request(h, "POST", "/api/cards", payload); w.Code != 201 {
		t.Fatalf("Unicode boundary: %d %s", w.Code, w.Body)
	}
	payload = `{"columnId":1,"title":"学習","description":"` + strings.Repeat(" ", 10001) + `"}`
	if w := request(h, "POST", "/api/cards", payload); w.Code != 400 {
		t.Fatalf("description overflow: %d", w.Code)
	}
	if w := request(h, "POST", "/api/columns", `{"name":"`+strings.Repeat("列", 60)+`"}`); w.Code != 201 {
		t.Fatalf("column boundary: %d", w.Code)
	}
	if w := request(h, "POST", "/api/columns", `{"name":"`+strings.Repeat("列", 61)+`"}`); w.Code != 400 {
		t.Fatalf("column overflow: %d", w.Code)
	}
}

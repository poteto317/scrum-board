package kanban

import (
	"cmp"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
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
	cols := slices.Clone(m.columns)
	slices.SortFunc(cols, func(a, b Column) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	b := Board{Columns: cols, Cards: []Card{}}
	for _, c := range m.cards {
		b.Cards = append(b.Cards, c)
	}
	slices.SortFunc(b.Cards, func(a, b Card) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
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
func (m *memoryRepo) nextPosition(columnID int64) int {
	maxPos := -1
	for _, c := range m.cards {
		if c.ColumnID == columnID && c.Position > maxPos {
			maxPos = c.Position
		}
	}
	return maxPos + 1
}
func (m *memoryRepo) compactColumn(columnID int64) {
	var ids []int64
	for _, c := range m.cards {
		if c.ColumnID == columnID {
			ids = append(ids, c.ID)
		}
	}
	slices.SortFunc(ids, func(a, b int64) int {
		ca, cb := m.cards[a], m.cards[b]
		if c := cmp.Compare(ca.Position, cb.Position); c != 0 {
			return c
		}
		return cmp.Compare(a, b)
	})
	for pos, id := range ids {
		c := m.cards[id]
		c.Position = pos
		m.cards[id] = c
	}
}
func (m *memoryRepo) CreateCard(_ context.Context, in CardInput) (Card, error) {
	if !m.validColumn(in.ColumnID) {
		return Card{}, ErrColumn
	}
	maxBacklog := -1
	for _, existing := range m.cards {
		if existing.BacklogPosition > maxBacklog {
			maxBacklog = existing.BacklogPosition
		}
	}
	c := Card{
		Number: m.next, ID: m.next, ColumnID: in.ColumnID,
		Title: in.Title, Description: in.Description, PRURL: in.PRURL,
		Position: m.nextPosition(in.ColumnID), BacklogPosition: maxBacklog + 1,
	}
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
		if *p.ColumnID != c.ColumnID {
			source := c.ColumnID
			c.ColumnID = *p.ColumnID
			c.Position = m.nextPosition(*p.ColumnID)
			m.cards[id] = c
			m.compactColumn(source)
			c = m.cards[id]
		}
	}
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.PRURL != nil {
		c.PRURL = *p.PRURL
	}
	m.cards[id] = c
	return c, nil
}
func (m *memoryRepo) ReorderCards(_ context.Context, orders []CardColumnOrder) ([]Card, error) {
	if err := validateCardOrder(orders); err != nil {
		return nil, err
	}
	for _, order := range orders {
		if !m.validColumn(order.ColumnID) {
			return nil, ErrCardOrderMismatch
		}
	}
	requested := map[int64]struct{}{}
	for _, order := range orders {
		for _, id := range order.CardIDs {
			requested[id] = struct{}{}
		}
	}
	listed := map[int64]struct{}{}
	for _, order := range orders {
		listed[order.ColumnID] = struct{}{}
	}
	existing := map[int64]Card{}
	for _, c := range m.cards {
		if _, ok := listed[c.ColumnID]; ok {
			existing[c.ID] = c
		}
	}
	if len(existing) != len(requested) {
		return nil, ErrCardOrderMismatch
	}
	for id := range requested {
		if _, ok := existing[id]; !ok {
			return nil, ErrCardOrderMismatch
		}
	}
	for _, order := range orders {
		for pos, id := range order.CardIDs {
			c := m.cards[id]
			c.ColumnID = order.ColumnID
			c.Position = pos
			m.cards[id] = c
		}
	}
	board, _ := m.Board(context.Background())
	return board.Cards, nil
}
func (m *memoryRepo) DeleteCard(ctx context.Context, id int64) error {
	if _, err := m.GetCard(ctx, id); err != nil {
		return err
	}
	delete(m.cards, id)
	return nil
}
func (m *memoryRepo) CreateColumn(_ context.Context, name string) (Column, error) {
	maxPos := -1
	var maxID int64
	for _, c := range m.columns {
		if strings.EqualFold(c.Name, name) {
			return Column{}, ErrDuplicate
		}
		if c.Position > maxPos {
			maxPos = c.Position
		}
		if c.ID > maxID {
			maxID = c.ID
		}
	}
	c := Column{ID: maxID + 1, Name: name, Position: maxPos + 1}
	m.columns = append(m.columns, c)
	return c, nil
}

func (m *memoryRepo) ReorderColumns(_ context.Context, columnIDs []int64) ([]Column, error) {
	if err := validateColumnOrder(columnIDs); err != nil {
		return nil, err
	}
	if len(columnIDs) != len(m.columns) {
		return nil, ErrColumnMismatch
	}
	byID := make(map[int64]Column, len(m.columns))
	for _, c := range m.columns {
		byID[c.ID] = c
	}
	next := make([]Column, len(columnIDs))
	for i, colID := range columnIDs {
		col, ok := byID[colID]
		if !ok {
			return nil, ErrColumnMismatch
		}
		col.Position = i
		next[i] = col
	}
	m.columns = next
	return slices.Clone(next), nil
}

func (m *memoryRepo) Backlog(context.Context) ([]Card, error) {
	cards := make([]Card, 0, len(m.cards))
	for _, c := range m.cards {
		cards = append(cards, c)
	}
	slices.SortFunc(cards, func(a, b Card) int {
		if c := cmp.Compare(a.BacklogPosition, b.BacklogPosition); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return cards, nil
}

func (m *memoryRepo) ReorderBacklog(_ context.Context, cardIDs []int64) ([]Card, error) {
	if err := validateBacklogOrder(cardIDs); err != nil {
		return nil, err
	}
	if len(cardIDs) != len(m.cards) {
		return nil, ErrBacklogMismatch
	}
	byID := make(map[int64]Card, len(m.cards))
	for _, c := range m.cards {
		byID[c.ID] = c
	}
	for i, id := range cardIDs {
		c, ok := byID[id]
		if !ok {
			return nil, ErrBacklogMismatch
		}
		c.BacklogPosition = i
		m.cards[id] = c
	}
	return m.Backlog(context.Background())
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

func (m *memoryRepo) GetCardByNumber(_ context.Context, number int64) (Card, error) {
	for _, card := range m.cards {
		if card.Number == number {
			return card, nil
		}
	}
	return Card{}, ErrNotFound
}
func TestGetCardByNumber(t *testing.T) {
	repo := fresh()
	repo.cards[18] = Card{ID: 18, Number: 3, ColumnID: 1, Title: "number three"}
	repo.cards[3] = Card{ID: 3, Number: 18, ColumnID: 1, Title: "number eighteen"}
	h := NewHandler(repo)
	for _, tc := range []struct {
		path       string
		id, number int64
	}{{"/api/cards/by-number/3", 18, 3}, {"/api/cards/by-number/18", 3, 18}, {"/api/cards/18", 18, 3}} {
		w := request(h, "GET", tc.path, "")
		var card Card
		_ = json.Unmarshal(w.Body.Bytes(), &card)
		if w.Code != 200 || card.ID != tc.id || card.Number != tc.number {
			t.Fatalf("%s: %d %+v", tc.path, w.Code, card)
		}
	}
	for _, tc := range []struct {
		number string
		status int
	}{{"999", 404}, {"0", 400}, {"-1", 400}, {"abc", 400}, {"9223372036854775808", 400}} {
		w := request(h, "GET", "/api/cards/by-number/"+tc.number, "")
		if w.Code != tc.status {
			t.Fatalf("%s: %d", tc.number, w.Code)
		}
	}
}

func (m *memoryRepo) GetColumnByName(_ context.Context, name string) (Column, error) {
	for _, c := range m.columns {
		if strings.EqualFold(c.Name, name) {
			return c, nil
		}
	}
	return Column{}, ErrColumn
}

func (m *memoryRepo) History(ctx context.Context, number, before int64) (HistoryPage, error) {
	_, err := m.GetCardByNumber(ctx, number)
	return HistoryPage{Events: []HistoryEvent{}}, err
}

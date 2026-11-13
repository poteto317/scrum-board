package kanban

import "testing"

func TestHistoryCursorValidationWithoutDatabase(t *testing.T) {
	repo := fresh()
	repo.cards[1] = Card{ID: 1, Number: 1, ColumnID: 1, Title: "history"}
	h := NewHandler(repo)
	for _, tc := range []struct {
		name, path string
		status     int
	}{
		{"no cursor", "/api/cards/by-number/1/history", 200},
		{"positive cursor", "/api/cards/by-number/1/history?before=5", 200},
		{"zero cursor", "/api/cards/by-number/1/history?before=0", 400},
		{"negative cursor", "/api/cards/by-number/1/history?before=-1", 400},
		{"empty cursor", "/api/cards/by-number/1/history?before=", 400},
		{"non numeric cursor", "/api/cards/by-number/1/history?before=abc", 400},
		{"repeated cursor", "/api/cards/by-number/1/history?before=1&before=2", 400},
		{"overflowing cursor", "/api/cards/by-number/1/history?before=99999999999999999999", 400},
		{"invalid number", "/api/cards/by-number/0/history", 400},
		{"missing card", "/api/cards/by-number/99/history", 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := request(h, "GET", tc.path, ""); w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
	if w := request(h, "POST", "/api/cards/by-number/1/history", ""); w.Code != 405 {
		t.Fatalf("POST status=%d", w.Code)
	}
}

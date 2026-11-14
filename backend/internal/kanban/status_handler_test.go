package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func statusRepo() *memoryRepo {
	r := fresh()
	r.columns = append(r.columns, Column{ID: 4, Name: "レビュー待ち"}, Column{ID: 5, Name: strings.Repeat("あ", 60)})
	r.cards[22] = Card{ID: 22, Number: 7, ColumnID: 1, Title: "keep title", Description: "keep description", PRURLs: []string{}, CreatedAt: time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)}
	r.cards[7] = Card{ID: 7, Number: 22, ColumnID: 1, Title: "other card", PRURLs: []string{}}
	return r
}
func TestStatusChangeByNumber(t *testing.T) {
	r := statusRepo()
	h := NewHandler(r)
	original := r.cards[22]
	other := r.cards[7]
	for _, tc := range []struct {
		status   string
		columnID int64
	}{{"Doing", 2}, {"Done", 3}, {"レビュー待ち", 4}, {" doing ", 2}, {strings.Repeat("あ", 60), 5}, {"Doing", 2}, {"Doing", 2}} {
		data, _ := json.Marshal(map[string]string{"status": tc.status})
		w := request(h, "PATCH", "/api/cards/by-number/7/status", string(data))
		if w.Code != 200 {
			t.Fatalf("%q: %d %s", tc.status, w.Code, w.Body)
		}
		var c Card
		if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		if c.ID != 22 || c.Number != 7 || c.ColumnID != tc.columnID || c.Title != original.Title || c.Description != original.Description || c.CreatedAt != original.CreatedAt {
			t.Fatalf("wrong update %+v", c)
		}
		if !reflect.DeepEqual(r.cards[7], other) || len(r.cards) != 2 || r.next != 1 {
			t.Fatal("unrelated card or sequence changed")
		}
	}
}
func TestStatusInvalidInputDoesNotUpdate(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		status           int
	}{
		{"empty object", "7", `{}`, 400}, {"empty status", "7", `{"status":""}`, 400}, {"blank status", "7", `{"status":"　 "}`, 400},
		{"null status", "7", `{"status":null}`, 400}, {"non-string", "7", `{"status":2}`, 400}, {"missing task", "999", `{"status":"Doing"}`, 404},
		{"zero number", "0", `{"status":"Doing"}`, 400}, {"negative number", "-1", `{"status":"Doing"}`, 400}, {"bad number", "no", `{"status":"Doing"}`, 400},
		{"overflow number", "9223372036854775808", `{"status":"Doing"}`, 400}, {"unknown status", "7", `{"status":"Unknown"}`, 400},
		{"SQL-like status", "7", `{"status":"Doing' OR 1=1 --"}`, 400}, {"unknown field", "7", `{"status":"Doing","title":"overwrite"}`, 400},
		{"multiple JSON", "7", `{"status":"Doing"}{}`, 400}, {"malformed", "7", `{`, 400}, {"null JSON", "7", `null`, 400},
		{"long Unicode", "7", `{"status":"` + strings.Repeat("あ", 61) + `"}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := statusRepo()
			before := r.cards[22]
			w := request(NewHandler(r), "PATCH", "/api/cards/by-number/"+tc.path+"/status", tc.body)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if !reflect.DeepEqual(r.cards[22], before) {
				t.Fatal("invalid request modified card")
			}
		})
	}
}

type statusFailureRepo struct {
	*memoryRepo
	cardError, columnError, updateError error
}

func (r statusFailureRepo) GetCardByNumber(ctx context.Context, n int64) (Card, error) {
	if r.cardError != nil {
		return Card{}, r.cardError
	}
	return r.memoryRepo.GetCardByNumber(ctx, n)
}
func (r statusFailureRepo) GetColumnByName(ctx context.Context, n string) (Column, error) {
	if r.columnError != nil {
		return Column{}, r.columnError
	}
	return r.memoryRepo.GetColumnByName(ctx, n)
}
func (r statusFailureRepo) UpdateCard(ctx context.Context, id int64, p CardPatch) (Card, error) {
	if r.updateError != nil {
		return Card{}, r.updateError
	}
	return r.memoryRepo.UpdateCard(ctx, id, p)
}
func TestStatusStorageFailures(t *testing.T) {
	internal := errors.New("internal-only database failure")
	for _, stage := range []string{"card", "column", "update"} {
		t.Run(stage, func(t *testing.T) {
			r := statusFailureRepo{memoryRepo: statusRepo()}
			switch stage {
			case "card":
				r.cardError = internal
			case "column":
				r.columnError = internal
			case "update":
				r.updateError = internal
			}
			before := r.cards[22]
			w := request(NewHandler(r), "PATCH", "/api/cards/by-number/7/status", `{"status":"Doing"}`)
			if w.Code != 500 || strings.Contains(w.Body.String(), internal.Error()) {
				t.Fatalf("unsafe failure %d %s", w.Code, w.Body)
			}
			if !reflect.DeepEqual(r.cards[22], before) {
				t.Fatal("failed request modified card")
			}
		})
	}
}

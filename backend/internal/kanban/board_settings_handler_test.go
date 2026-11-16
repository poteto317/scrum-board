package kanban

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestUpdateBoardSettingsHandler(t *testing.T) {
	repo := fresh()
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "low", Position: 0, OffsetY: 320}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, Title: "high", Position: 1, OffsetY: 0}
	repo.cards[3] = Item{ID: 3, Number: 3, ColumnID: 2, Title: "other", Position: 0, OffsetY: 80}
	repo.settings.CardLayout = CardLayoutFree
	h := NewHandler(repo)

	w := request(h, "PATCH", "/api/board/settings", `{"cardLayout":"pack"}`)
	if w.Code != 200 {
		t.Fatalf("free→pack: %d %s", w.Code, w.Body)
	}
	var out struct {
		Settings BoardSettings `json:"settings"`
		Items    []Item        `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Settings.CardLayout != CardLayoutPack {
		t.Fatalf("settings: %+v", out.Settings)
	}
	if len(out.Items) != 3 {
		t.Fatalf("want items on pack response, got %d", len(out.Items))
	}
	todo := cardsInColumn(out.Items, 1)
	if len(todo) != 2 || todo[0].ID != 2 || todo[1].ID != 1 {
		t.Fatalf("free→pack position order: %+v", todo)
	}
	if todo[0].Position != 0 || todo[1].Position != 1 {
		t.Fatalf("positions: %+v", todo)
	}
	if todo[0].OffsetY != 0 || todo[1].OffsetY != 320 {
		t.Fatalf("offsetY must be preserved: %+v", todo)
	}

	w = request(h, "PATCH", "/api/board/settings", `{"cardLayout":"free"}`)
	if w.Code != 200 {
		t.Fatalf("pack→free: %d %s", w.Code, w.Body)
	}
	var freeOut map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &freeOut); err != nil {
		t.Fatal(err)
	}
	if _, ok := freeOut["settings"]; !ok {
		t.Fatal("missing settings")
	}
	if _, ok := freeOut["items"]; ok {
		t.Fatalf("pack→free must omit items: %s", w.Body)
	}
	if repo.settings.CardLayout != CardLayoutFree {
		t.Fatalf("stored layout: %s", repo.settings.CardLayout)
	}
}

func TestUpdateBoardSettingsValidation(t *testing.T) {
	h := NewHandler(fresh())
	for _, tc := range []struct {
		name, body string
	}{
		{"empty", `{}`},
		{"blank", `{"cardLayout":""}`},
		{"unknown value", `{"cardLayout":"grid"}`},
		{"unknown field", `{"cardLayout":"pack","oops":1}`},
		{"null", `{"cardLayout":null}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, "PATCH", "/api/board/settings", tc.body)
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

func TestUpdateBoardSettingsStorageFailure(t *testing.T) {
	secret := "internal-board-settings-db-failure"
	repo := fresh()
	repo.settingsFail = errors.New(secret)
	w := request(NewHandler(repo), "PATCH", "/api/board/settings", `{"cardLayout":"free"}`)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatalf("leaked: %s", w.Body.String())
	}
	if repo.settings.CardLayout != CardLayoutPack {
		t.Fatal("failed update must not change settings")
	}
}

func TestBoardIncludesSettings(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutFree
	w := request(NewHandler(repo), "GET", "/api/board", "")
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	settings, ok := raw["settings"].(map[string]any)
	if !ok {
		t.Fatalf("missing settings: %s", w.Body)
	}
	if settings["cardLayout"] != CardLayoutFree {
		t.Fatalf("cardLayout=%v", settings["cardLayout"])
	}
}

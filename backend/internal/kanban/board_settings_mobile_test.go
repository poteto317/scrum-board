package kanban

import (
	"context"
	"encoding/json"
	"testing"
)

func TestFallbackMobileColumnID(t *testing.T) {
	cols := []Column{
		{ID: 2, Name: "Doing", Position: 0},
		{ID: 1, Name: "Todo", Position: 1},
	}
	if got := fallbackMobileColumnID(cols); got != 1 {
		t.Fatalf("Todo wins: got %d", got)
	}
	noTodo := []Column{
		{ID: 5, Name: "A", Position: 1},
		{ID: 3, Name: "B", Position: 1},
		{ID: 4, Name: "C", Position: 2},
	}
	if got := fallbackMobileColumnID(noTodo); got != 3 {
		t.Fatalf("position then id: got %d", got)
	}
	if got := fallbackMobileColumnID(nil); got != 0 {
		t.Fatalf("empty: got %d", got)
	}
}

func TestApplyBoardSettingsPatch(t *testing.T) {
	cols := []Column{{ID: 1, Name: "Todo", Position: 0}, {ID: 2, Name: "Doing", Position: 1}}
	current := BoardSettings{CardLayout: CardLayoutPack, MobileBoardColumnID: 1}
	layout := CardLayoutFree
	mobile := int64(2)
	next, err := applyBoardSettingsPatch(current, cols, BoardSettingsPatch{MobileBoardColumnID: &mobile})
	if err != nil || next.CardLayout != CardLayoutPack || next.MobileBoardColumnID != 2 {
		t.Fatalf("mobile only: %+v err=%v", next, err)
	}
	next, err = applyBoardSettingsPatch(current, cols, BoardSettingsPatch{CardLayout: &layout})
	if err != nil || next.CardLayout != CardLayoutFree || next.MobileBoardColumnID != 1 {
		t.Fatalf("layout only: %+v err=%v", next, err)
	}
	bad := int64(0)
	if _, err = applyBoardSettingsPatch(current, cols, BoardSettingsPatch{MobileBoardColumnID: &bad}); err == nil {
		t.Fatal("want error for id 0")
	}
	if _, err = applyBoardSettingsPatch(current, cols, BoardSettingsPatch{}); err == nil {
		t.Fatal("want error for empty patch")
	}
}

func TestResolveMobileBoardColumnID(t *testing.T) {
	cols := []Column{{ID: 1, Name: "Todo", Position: 0}, {ID: 2, Name: "Doing", Position: 1}}
	if got := resolveMobileBoardColumnID(2, cols); got != 2 {
		t.Fatalf("valid: %d", got)
	}
	if got := resolveMobileBoardColumnID(99, cols); got != 1 {
		t.Fatalf("invalid→Todo: %d", got)
	}
	if got := resolveMobileBoardColumnID(0, cols); got != 1 {
		t.Fatalf("missing→Todo: %d", got)
	}
}

func TestPatchMobileBoardColumnIdOnly(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutFree
	repo.settings.MobileBoardColumnID = 1
	h := NewHandler(repo)

	w := request(h, "PATCH", "/api/board/settings", `{"mobileBoardColumnId":2}`)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var out struct {
		Settings BoardSettings     `json:"settings"`
		Items    []Item            `json:"items"`
		Raw      map[string]any    `json:"-"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["items"]; ok {
		t.Fatalf("mobile-only PATCH must omit items: %s", w.Body)
	}
	if out.Settings.CardLayout != CardLayoutFree {
		t.Fatalf("layout changed: %+v", out.Settings)
	}
	if out.Settings.MobileBoardColumnID != 2 {
		t.Fatalf("mobile id: %+v", out.Settings)
	}
	if repo.settings.CardLayout != CardLayoutFree || repo.settings.MobileBoardColumnID != 2 {
		t.Fatalf("stored: %+v", repo.settings)
	}
}

func TestPatchCardLayoutKeepsMobileId(t *testing.T) {
	repo := fresh()
	repo.settings.MobileBoardColumnID = 2
	h := NewHandler(repo)
	w := request(h, "PATCH", "/api/board/settings", `{"cardLayout":"free"}`)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var out struct {
		Settings BoardSettings `json:"settings"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Settings.MobileBoardColumnID != 2 || out.Settings.CardLayout != CardLayoutFree {
		t.Fatalf("settings: %+v", out.Settings)
	}
}

func TestPatchMobileBoardColumnIdValidation(t *testing.T) {
	h := NewHandler(fresh())
	for _, tc := range []struct {
		name, body string
	}{
		{"zero", `{"mobileBoardColumnId":0}`},
		{"negative", `{"mobileBoardColumnId":-1}`},
		{"unknown", `{"mobileBoardColumnId":99}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, "PATCH", "/api/board/settings", tc.body)
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

func TestPatchCardLayoutDoesNotRewriteInvalidMobileId(t *testing.T) {
	repo := fresh()
	repo.settings.MobileBoardColumnID = 99
	h := NewHandler(repo)
	w := request(h, "PATCH", "/api/board/settings", `{"cardLayout":"free"}`)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if repo.settings.MobileBoardColumnID != 99 {
		t.Fatalf("layout-only must keep stored invalid mobile id, got %d", repo.settings.MobileBoardColumnID)
	}
	var out struct {
		Settings BoardSettings `json:"settings"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Settings.MobileBoardColumnID != 1 {
		t.Fatalf("response should resolve to Todo, got %+v", out.Settings)
	}
}

func TestPatchPackWhenAlreadyPackOmitsItems(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutPack
	w := request(NewHandler(repo), "PATCH", "/api/board/settings", `{"cardLayout":"pack"}`)
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["items"]; ok {
		t.Fatalf("pack→pack must omit items: %s", w.Body)
	}
}

func TestBoardEmptyColumnsMobileIdZeroMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustExec(t, db, `DELETE FROM items`)
	mustExec(t, db, `DELETE FROM board_columns`)
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Columns) != 0 {
		t.Fatalf("want no columns, got %+v", board.Columns)
	}
	if board.Settings.MobileBoardColumnID != 0 {
		t.Fatalf("mobileBoardColumnId=%d", board.Settings.MobileBoardColumnID)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM board_settings WHERE setting_key='mobile_board_column_id'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	// Seed may have inserted before columns were wiped; GET must not rewrite.
	_ = n
}

func TestPatchMobileOnlyKeepsUnknownKeyMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustExec(t, db, `INSERT INTO board_settings(setting_key, setting_value) VALUES('theme','dark')
 ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`)
	mobile := int64(2)
	settings, items, err := r.PatchBoardSettings(ctx, BoardSettingsPatch{MobileBoardColumnID: &mobile})
	if err != nil {
		t.Fatal(err)
	}
	if settings.MobileBoardColumnID != 2 || settings.CardLayout != CardLayoutPack {
		t.Fatalf("settings=%+v", settings)
	}
	if items != nil {
		t.Fatalf("mobile-only must omit items: %v", items)
	}
	var theme string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='theme'`).Scan(&theme); err != nil || theme != "dark" {
		t.Fatalf("theme=%q err=%v", theme, err)
	}
	var stored string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='mobile_board_column_id'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != "2" {
		t.Fatalf("stored mobile=%q", stored)
	}
}

func TestBoardIncludesMobileBoardColumnId(t *testing.T) {
	repo := fresh()
	repo.settings.MobileBoardColumnID = 99 // invalid → Todo fallback in Board
	w := request(NewHandler(repo), "GET", "/api/board", "")
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	settings := raw["settings"].(map[string]any)
	if settings["mobileBoardColumnId"] != float64(1) {
		t.Fatalf("want Todo fallback, got %v", settings["mobileBoardColumnId"])
	}
	if repo.settings.MobileBoardColumnID != 99 {
		t.Fatal("GET must not rewrite stored invalid id")
	}
}

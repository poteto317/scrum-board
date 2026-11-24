package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// requestWithHeader sends a GET with If-None-Match as the default admin session.
func requestWithHeader(h http.Handler, method, path, ifNoneMatch string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	r.Header.Set("If-None-Match", ifNoneMatch)
	h.ServeHTTP(w, r)
	return w
}

func decodeJSONMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("invalid JSON: %v body=%s", err, body)
	}
	return raw
}

func TestBoardMetaReturnsColumnsAndSettingsWithoutItems(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutFree
	if _, err := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "x", Description: ""}); err != nil {
		t.Fatal(err)
	}
	w := request(NewHandler(repo), "GET", "/api/board/meta", "")
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	raw := decodeJSONMap(t, w.Body.Bytes())
	if len(raw) != 2 {
		t.Fatalf("want only columns and settings, got keys %v", raw)
	}
	if _, ok := raw["items"]; ok {
		t.Fatalf("items must not be returned: %s", w.Body)
	}
	cols, ok := raw["columns"].([]any)
	if !ok || len(cols) != 3 {
		t.Fatalf("columns=%v", raw["columns"])
	}
	settings, ok := raw["settings"].(map[string]any)
	if !ok {
		t.Fatalf("missing settings: %s", w.Body)
	}
	if settings["cardLayout"] != CardLayoutFree {
		t.Fatalf("cardLayout=%v", settings["cardLayout"])
	}
	if settings["mobileBoardColumnId"] != float64(1) || settings["activeProjectId"] != float64(1) {
		t.Fatalf("settings=%v", settings)
	}
}

func TestBoardMetaMatchesBoardEnvelope(t *testing.T) {
	repo := fresh()
	repo.settings.ActiveProjectID = 999 // missing project: resolved like GET /api/board
	repo.settings.MobileBoardColumnID = 999
	repo.columns = append(repo.columns, Column{ID: 4, Name: "Review", Position: 3})
	h := NewHandler(repo)
	meta := request(h, "GET", "/api/board/meta", "")
	board := request(h, "GET", "/api/board", "")
	if meta.Code != 200 || board.Code != 200 {
		t.Fatalf("meta=%d board=%d", meta.Code, board.Code)
	}
	var m BoardMeta
	var b Board
	if err := json.Unmarshal(meta.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(board.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(m.Columns, b.Columns) {
		t.Fatalf("columns differ: meta=%v board=%v", m.Columns, b.Columns)
	}
	if !reflect.DeepEqual(m.Settings, b.Settings) {
		t.Fatalf("settings differ: meta=%+v board=%+v", m.Settings, b.Settings)
	}
}

func TestBoardMetaETag304(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	first := request(h, "GET", "/api/board/meta", "")
	etag := first.Header().Get("ETag")
	if first.Code != 200 || etag == "" {
		t.Fatalf("status=%d etag=%q", first.Code, etag)
	}
	again := requestWithHeader(h, "GET", "/api/board/meta", etag)
	if again.Code != 304 || again.Body.Len() != 0 {
		t.Fatalf("status=%d body=%q", again.Code, again.Body)
	}
	repo.columns = append(repo.columns, Column{ID: 4, Name: "Review", Position: 3})
	changed := requestWithHeader(h, "GET", "/api/board/meta", etag)
	if changed.Code != 200 || changed.Header().Get("ETag") == etag {
		t.Fatalf("status=%d etag=%q old=%q", changed.Code, changed.Header().Get("ETag"), etag)
	}
}

func TestBoardMetaRequiresSession(t *testing.T) {
	w := requestAnon(NewHandler(fresh()), "GET", "/api/board/meta", "")
	if w.Code != 401 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
}

func TestBoardMetaAllowsNonAdminUser(t *testing.T) {
	const secretTitle = "restricted-secret-title-118"
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	secret, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: secretTitle, Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[secret.ID] = secret
	m.aclEntries = map[int64]ItemACL{secret.ID: {ViewUserIDs: []int64{1}}}
	sess := Session{ID: "mem-meta-sess", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	h := NewHandler(m)

	member := requestWithCookie(h, "GET", "/api/board/meta", "", sess.ID)
	admin := request(h, "GET", "/api/board/meta", "")
	if member.Code != 200 {
		t.Fatalf("status=%d body=%s", member.Code, member.Body)
	}
	if member.Body.String() != admin.Body.String() {
		t.Fatalf("member and admin differ:\nmember=%s\nadmin=%s", member.Body, admin.Body)
	}
	if strings.Contains(member.Body.String(), secretTitle) {
		t.Fatalf("leaked restricted item: %s", member.Body)
	}
}

func TestBoardMetaIgnoresInvalidProjectID(t *testing.T) {
	h := NewHandler(fresh())
	base := request(h, "GET", "/api/board/meta", "")
	if base.Code != 200 {
		t.Fatalf("status=%d", base.Code)
	}
	for _, q := range []string{"?projectId=abc", "?projectId=999999", "?projectId=-1", "?projectId=1&projectId=2"} {
		w := request(h, "GET", "/api/board/meta"+q, "")
		if w.Code != 200 {
			t.Fatalf("%s status=%d body=%s", q, w.Code, w.Body)
		}
		if w.Body.String() != base.Body.String() {
			t.Fatalf("%s body differs:\n%s\n%s", q, w.Body, base.Body)
		}
	}
}

func TestBoardMetaStorageFailure(t *testing.T) {
	repo := fresh()
	repo.boardMetaFail = errors.New("db exploded: secret-dsn")
	w := request(NewHandler(repo), "GET", "/api/board/meta", "")
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "secret-dsn") {
		t.Fatalf("leaked internal error: %s", w.Body)
	}
}

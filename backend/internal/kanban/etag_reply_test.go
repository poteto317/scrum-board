package kanban

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func requestWithETag(h http.Handler, method, path, ifNoneMatch string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	if ifNoneMatch != "" {
		r.Header.Set("If-None-Match", ifNoneMatch)
	}
	h.ServeHTTP(w, r)
	return w
}

func TestIfNoneMatchSatisfied(t *testing.T) {
	etag := `"abc"`
	cases := []struct {
		name, header string
		want         bool
	}{
		{"empty", "", false},
		{"exact", `"abc"`, true},
		{"mismatch", `"xyz"`, false},
		{"star", "*", true},
		{"second of two", `"nope", "abc"`, true},
		{"weak form", `W/"abc"`, true},
		{"weak lowercase", `w/"abc"`, true},
		{"spaces", `  "abc"  `, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ifNoneMatchSatisfied(tc.header, etag); got != tc.want {
				t.Fatalf("header=%q got %v want %v", tc.header, got, tc.want)
			}
		})
	}
}

func TestBoardETag304(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	first := requestWithETag(h, "GET", "/api/board", "")
	if first.Code != 200 {
		t.Fatalf("first status %d", first.Code)
	}
	if ct := first.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("content-type %q", ct)
	}
	if first.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache-control %q", first.Header().Get("Cache-Control"))
	}
	etag := first.Header().Get("ETag")
	if etag == "" || etag[0] != '"' {
		t.Fatalf("etag %q", etag)
	}
	sum := sha256.Sum256(first.Body.Bytes())
	want := `"` + hex.EncodeToString(sum[:]) + `"`
	if etag != want {
		t.Fatalf("etag %q want %q", etag, want)
	}

	second := requestWithETag(h, "GET", "/api/board", etag)
	if second.Code != 304 {
		t.Fatalf("second status %d body %s", second.Code, second.Body.String())
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 body %q", second.Body.String())
	}
	if second.Header().Get("Content-Type") != "" {
		t.Fatalf("304 content-type %q", second.Header().Get("Content-Type"))
	}
	if second.Header().Get("ETag") != etag {
		t.Fatalf("304 etag %q", second.Header().Get("ETag"))
	}
	if second.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("304 cache-control %q", second.Header().Get("Cache-Control"))
	}

	weak := requestWithETag(h, "GET", "/api/board", `W/`+etag)
	if weak.Code != 304 {
		t.Fatalf("weak status %d", weak.Code)
	}
	star := requestWithETag(h, "GET", "/api/board", "*")
	if star.Code != 304 {
		t.Fatalf("star status %d", star.Code)
	}
	multi := requestWithETag(h, "GET", "/api/board", `"nope", `+etag)
	if multi.Code != 304 {
		t.Fatalf("multi status %d", multi.Code)
	}
	miss := requestWithETag(h, "GET", "/api/board", `"deadbeef"`)
	if miss.Code != 200 {
		t.Fatalf("miss status %d", miss.Code)
	}
}

func TestBoardETagChangesAfterMutation(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	first := requestWithETag(h, "GET", "/api/board", "")
	etag1 := first.Header().Get("ETag")

	create := request(h, "POST", "/api/items", `{"title":"etag-card","columnId":1}`)
	if create.Code != 200 && create.Code != 201 {
		t.Fatalf("create %d %s", create.Code, create.Body.String())
	}

	second := requestWithETag(h, "GET", "/api/board", etag1)
	if second.Code != 200 {
		t.Fatalf("after mutate expected 200 got %d", second.Code)
	}
	etag2 := second.Header().Get("ETag")
	if etag2 == "" || etag2 == etag1 {
		t.Fatalf("etag should change: before %q after %q", etag1, etag2)
	}
	third := requestWithETag(h, "GET", "/api/board", etag2)
	if third.Code != 304 {
		t.Fatalf("third %d", third.Code)
	}
}

func TestBacklogETag304(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	first := requestWithETag(h, "GET", "/api/backlog", "")
	if first.Code != 200 {
		t.Fatalf("first %d", first.Code)
	}
	etag := first.Header().Get("ETag")
	second := requestWithETag(h, "GET", "/api/backlog", etag)
	if second.Code != 304 {
		t.Fatalf("second %d", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 body %q", second.Body.String())
	}
	if second.Header().Get("Content-Type") != "" {
		t.Fatalf("content-type %q", second.Header().Get("Content-Type"))
	}
}

func TestETagDiffersForDifferentBodies(t *testing.T) {
	// Documents that handlers must pass post-ACL bodies: different JSON ⇒ different tags.
	a, _ := json.Marshal(map[string]any{"items": []any{}})
	b, _ := json.Marshal(map[string]any{"items": []any{map[string]any{"id": 1}}})
	ea := `"` + hex.EncodeToString(sha256Sum(a)) + `"`
	eb := `"` + hex.EncodeToString(sha256Sum(b)) + `"`
	if ea == eb {
		t.Fatal("expected different etags for different bodies")
	}
}

func TestBoardETagNotSharedAcrossACLViews(t *testing.T) {
	m := fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	_, _ = m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "open", Description: "d"})
	secret, _ := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[secret.ID] = secret
	m.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}}
	memSess := Session{ID: "mem-etag", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[memSess.ID] = memSess
	h := NewHandler(m)

	admin := requestWithETag(h, "GET", "/api/board", "")
	if admin.Code != 200 {
		t.Fatalf("admin %d", admin.Code)
	}
	adminETag := admin.Header().Get("ETag")

	memW := httptest.NewRecorder()
	memR := httptest.NewRequest("GET", "/api/board", nil)
	memR.AddCookie(&http.Cookie{Name: SessionCookieName, Value: memSess.ID})
	memR.Header.Set("If-None-Match", adminETag)
	h.ServeHTTP(memW, memR)
	if memW.Code != 200 {
		t.Fatalf("member with admin etag must not 304, got %d", memW.Code)
	}
	if memW.Header().Get("ETag") == adminETag {
		t.Fatal("member etag should differ when ACL filters items")
	}
}

func sha256Sum(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

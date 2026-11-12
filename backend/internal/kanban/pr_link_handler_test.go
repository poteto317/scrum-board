package kanban

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPRLinkHTTP(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	url := "https://github.com/poteto317/scrum-board/pull/2"
	w := request(h, "POST", "/api/cards", `{"title":"keep","columnId":1,"description":"body","prUrl":"  `+url+`  "}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	read := func(method, path, body string) map[string]any {
		t.Helper()
		w := request(h, method, path, body)
		if w.Code != 200 {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
		var c map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	c := read("GET", "/api/cards/by-number/1", "")
	if c["prUrl"] != url {
		t.Fatalf("link not saved: %+v", c)
	}
	for _, body := range []string{`{"title":"keep"}`, `{"prUrl":null,"description":"body"}`, `{"prUrl":"  ` + url + `  "}`, `{"columnId":2}`} {
		c = read("PATCH", "/api/cards/1", body)
		if c["prUrl"] != url || c["title"] != "keep" || c["description"] != "body" {
			t.Fatalf("partial update: %+v", c)
		}
	}
	for _, bad := range []any{true, 42, []string{url}, "javascript:alert(1)", "https://github.com.evil/owner/repo/pull/1", "https://user@github.com/a/b/pull/1", "http://github.com/a/b/pull/1", "https://github.com:443/a/b/pull/1", "https://github.com/a/b/pull/0", "https://github.com/a/b/pull/1/", "https://github.com/a/b/pull/1?q=1", "https://github.com/a/b/pull/1#x", "https://github.com/a/../pull/1", "https://github.com/./b/pull/1", "https://github.com/a/b/pull/01", "https://github.com/a/b/pull/1\nfoo", strings.Repeat("x", 2049)} {
		body, _ := json.Marshal(map[string]any{"prUrl": bad, "title": "must not change"})
		before := read("GET", "/api/cards/1", "")
		w := request(h, "PATCH", "/api/cards/1", string(body))
		if w.Code != 400 {
			t.Fatalf("bad %v: %d %s", bad, w.Code, w.Body)
		}
		if after := read("GET", "/api/cards/1", ""); !reflect.DeepEqual(before, after) {
			t.Fatal("invalid request mutated card")
		}
	}
	c = read("PATCH", "/api/cards/1", `{"prUrl":""}`)
	if c["prUrl"] != "" {
		t.Fatalf("clear: %+v", c)
	}
}

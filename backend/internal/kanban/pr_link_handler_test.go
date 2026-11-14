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
	url2 := "https://github.com/poteto317/scrum-board/pull/3"
	w := request(h, "POST", "/api/cards", `{"title":"keep","columnId":1,"description":"body","prUrls":["  `+url+`  "]}`)
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
	asURLs := func(c map[string]any) []string {
		t.Helper()
		raw, _ := json.Marshal(c["prUrls"])
		var urls []string
		if err := json.Unmarshal(raw, &urls); err != nil {
			t.Fatal(err)
		}
		return urls
	}
	c := read("GET", "/api/cards/by-number/1", "")
	if !reflect.DeepEqual(asURLs(c), []string{url}) {
		t.Fatalf("link not saved: %+v", c)
	}
	for _, body := range []string{`{"title":"keep"}`, `{"prUrls":null,"description":"body"}`, `{"prUrls":["  ` + url + `  "]}`, `{"columnId":2}`} {
		c = read("PATCH", "/api/cards/1", body)
		if !reflect.DeepEqual(asURLs(c), []string{url}) || c["title"] != "keep" || c["description"] != "body" {
			t.Fatalf("partial update: %+v", c)
		}
	}
	c = read("PATCH", "/api/cards/1", `{"prUrls":["`+url+`","`+url2+`"]}`)
	if !reflect.DeepEqual(asURLs(c), []string{url, url2}) {
		t.Fatalf("multi: %+v", c)
	}
	for _, bad := range []any{
		true, 42, url, "", []any{""}, []any{"  "}, []any{url, url},
		[]any{"javascript:alert(1)"}, []any{"https://github.com.evil/owner/repo/pull/1"},
		[]any{strings.Repeat("x", 2049)},
	} {
		body, _ := json.Marshal(map[string]any{"prUrls": bad, "title": "must not change"})
		before := read("GET", "/api/cards/1", "")
		w := request(h, "PATCH", "/api/cards/1", string(body))
		if w.Code != 400 {
			t.Fatalf("bad %v: %d %s", bad, w.Code, w.Body)
		}
		if after := read("GET", "/api/cards/1", ""); !reflect.DeepEqual(before, after) {
			t.Fatal("invalid request mutated card")
		}
	}
	w = request(h, "PATCH", "/api/cards/1", `{"prUrl":"`+url+`"}`)
	if w.Code != 400 {
		t.Fatalf("legacy prUrl key: %d %s", w.Code, w.Body)
	}
	c = read("PATCH", "/api/cards/1", `{"prUrls":[]}`)
	if !reflect.DeepEqual(asURLs(c), []string{}) {
		t.Fatalf("clear: %+v", c)
	}
}

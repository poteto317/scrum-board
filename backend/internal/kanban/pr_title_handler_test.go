package kanban

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestGetItemEnrichesPRTitles(t *testing.T) {
	repo := fresh()
	url := "https://github.com/poteto317/scrum-board/pull/5"
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"Add feature"}`)),
		}, nil
	})
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(rt)))
	request(h, "POST", "/api/items", `{"title":"x","columnId":1,"prUrls":["`+url+`"]}`)
	w := request(h, "GET", "/api/items/1", "")
	if w.Code != 200 {
		t.Fatalf("GET %d %s", w.Code, w.Body)
	}
	var item Item
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if len(item.PRTitles) != 1 || item.PRTitles[0] != "Add feature" {
		t.Fatalf("prTitles %#v", item.PRTitles)
	}
	if len(item.PRURLs) != 1 || item.PRURLs[0] != url {
		t.Fatalf("prUrls %#v", item.PRURLs)
	}
}

func TestBoardDoesNotEnrichPRTitles(t *testing.T) {
	repo := fresh()
	url := "https://github.com/o/r/pull/1"
	var trips int
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		trips++
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"T"}`)),
		}, nil
	})
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(rt)))
	request(h, "POST", "/api/items", `{"title":"x","columnId":1,"prUrls":["`+url+`"]}`)
	w := request(h, "GET", "/api/board", "")
	if w.Code != 200 {
		t.Fatalf("board %d", w.Code)
	}
	if trips != 0 {
		t.Fatalf("board must not resolve titles, trips=%d", trips)
	}
	var b Board
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if len(b.Items) != 1 || len(b.Items[0].PRTitles) != 0 {
		t.Fatalf("items[0].prTitles %#v", b.Items[0].PRTitles)
	}
}

func TestBatchPRTitles(t *testing.T) {
	repo := fresh()
	u1 := "https://github.com/a/b/pull/1"
	u2 := "https://github.com/a/b/pull/2"
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "/pulls/1") {
			return &http.Response{
				StatusCode: 200,
				Body:       io.NopCloser(strings.NewReader(`{"title":"One"}`)),
			}, nil
		}
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	})
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(rt)))
	body := `{"urls":["` + u1 + `","` + u2 + `","not-a-url","https://evil.example/x"]}`
	w := request(h, "POST", "/api/pr-titles", body)
	if w.Code != 200 {
		t.Fatalf("POST %d %s", w.Code, w.Body)
	}
	var out struct {
		Titles map[string]string `json:"titles"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Titles) != 2 {
		t.Fatalf("titles %#v", out.Titles)
	}
	if out.Titles[u1] != "One" || out.Titles[u2] != "a/b#2" {
		t.Fatalf("titles %#v", out.Titles)
	}
	if _, ok := out.Titles["not-a-url"]; ok {
		t.Fatal("invalid url must be omitted")
	}
}

func TestBatchPRTitlesErrorJSONNoSecrets(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "ghp_testsecret123456")
	repo := fresh()
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, http.ErrHandlerTimeout
	}))))
	url := "https://github.com/o/r/pull/1"
	w := request(h, "POST", "/api/pr-titles", `{"urls":["`+url+`"]}`)
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body)
	}
	body := w.Body.String()
	if strings.Contains(body, "ghp_") || strings.Contains(body, "Bearer") {
		t.Fatalf("response leaks secret: %s", body)
	}
}

func TestPatchItemDoesNotReturnPRTitles(t *testing.T) {
	repo := fresh()
	url := "https://github.com/o/r/pull/1"
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"T"}`)),
		}, nil
	}))))
	request(h, "POST", "/api/items", `{"title":"x","columnId":1,"prUrls":["`+url+`"]}`)
	w := request(h, "PATCH", "/api/items/1", `{"title":"y"}`)
	var item Item
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.PRTitles != nil {
		t.Fatalf("PATCH must not enrich prTitles: %#v", item.PRTitles)
	}
}

func TestGetItemByNumberEnrichesPRTitles(t *testing.T) {
	repo := fresh()
	url := "https://github.com/o/r/pull/8"
	h := NewHandler(repo, WithPRTitleResolver(NewPRTitleResolver(roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"title":"By number"}`)),
		}, nil
	}))))
	request(h, "POST", "/api/items", `{"title":"x","columnId":1,"prUrls":["`+url+`"]}`)
	w := request(h, "GET", "/api/items/by-number/1", "")
	var item Item
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if len(item.PRTitles) != 1 || item.PRTitles[0] != "By number" {
		t.Fatalf("prTitles %#v", item.PRTitles)
	}
}

func TestBatchPRTitlesRejectsTooMany(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	urls := make([]string, maxPRTitleBatch+1)
	for i := range urls {
		urls[i] = "https://github.com/o/r/pull/" + strconv.Itoa(i+1)
	}
	body, _ := json.Marshal(map[string]any{"urls": urls})
	w := request(h, "POST", "/api/pr-titles", string(body))
	if w.Code != 400 {
		t.Fatalf("want 400 got %d %s", w.Code, w.Body)
	}
}
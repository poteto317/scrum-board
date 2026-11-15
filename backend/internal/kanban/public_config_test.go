package kanban

import (
	"encoding/json"
	"testing"
)

func TestNormalizePublicOrigin(t *testing.T) {
	if got := NormalizePublicOrigin(" https://x.example/ "); got != "https://x.example" {
		t.Fatalf("trim: %q", got)
	}
	if got := NormalizePublicOrigin(""); got != "" {
		t.Fatalf("empty: %q", got)
	}
}

func TestPublicConfigHTTP(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "GET", "/api/public-config", "")
	if w.Code != 200 {
		t.Fatalf("empty: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		PublicOrigin string `json:"publicOrigin"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.PublicOrigin != "" {
		t.Fatalf("want empty, got %q", body.PublicOrigin)
	}

	h = NewHandler(fresh(), WithPublicOrigin(" https://board.example/ "))
	w = request(h, "GET", "/api/public-config", "")
	if w.Code != 200 {
		t.Fatalf("set: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.PublicOrigin != "https://board.example" {
		t.Fatalf("got %q", body.PublicOrigin)
	}
}

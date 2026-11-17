package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeCloseReason(t *testing.T) {
	t.Parallel()
	got, ok := NormalizeCloseReason("  hello  ")
	if !ok || got != "hello" {
		t.Fatalf("trim: got %q ok=%v", got, ok)
	}
	got, ok = NormalizeCloseReason("")
	if !ok || got != "" {
		t.Fatalf("empty: got %q ok=%v", got, ok)
	}
	if _, ok = NormalizeCloseReason(strings.Repeat("あ", maxCloseReasonLen+1)); ok {
		t.Fatal("expected overflow to fail")
	}
	got, ok = NormalizeCloseReason(strings.Repeat("あ", maxCloseReasonLen))
	if !ok || utf8.RuneCountInString(got) != maxCloseReasonLen {
		t.Fatalf("max: ok=%v len=%d", ok, utf8.RuneCountInString(got))
	}
}

func TestCreateItemCloseReason(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"with reason","description":"d","columnId":1,"closeReason":"  parked  "}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "parked" {
		t.Fatalf("create closeReason: %q", card.CloseReason)
	}
	overflow := request(h, "POST", "/api/items", `{"title":"overflow","description":"d","columnId":1,"closeReason":"`+strings.Repeat("あ", maxCloseReasonLen+1)+`"}`)
	if overflow.Code != 400 {
		t.Fatalf("create overflow: %d", overflow.Code)
	}
}

func TestUpdateItemCloseReason(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"Close me","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "" {
		t.Fatalf("default closeReason: %q", card.CloseReason)
	}

	idPath := "/api/items/" + strconv.FormatInt(card.ID, 10)
	w := request(h, "PATCH", idPath, `{"closeReason":"  wont fix  "}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "wont fix" {
		t.Fatalf("saved: %q", card.CloseReason)
	}

	omit := request(h, "PATCH", idPath, `{"title":"Close me2"}`)
	if omit.Code != 200 {
		t.Fatalf("omit: %d %s", omit.Code, omit.Body.String())
	}
	if err := json.Unmarshal(omit.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "wont fix" {
		t.Fatalf("omit should keep reason: %q", card.CloseReason)
	}

	nullBody := request(h, "PATCH", idPath, `{"closeReason":null,"title":"Close me3"}`)
	if nullBody.Code != 200 {
		t.Fatalf("null: %d %s", nullBody.Code, nullBody.Body.String())
	}
	if err := json.Unmarshal(nullBody.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "wont fix" {
		t.Fatalf("null should keep reason: %q", card.CloseReason)
	}

	overflow := request(h, "PATCH", idPath, `{"closeReason":"`+strings.Repeat("あ", maxCloseReasonLen+1)+`"}`)
	if overflow.Code != 400 {
		t.Fatalf("overflow: %d", overflow.Code)
	}

	clear := request(h, "PATCH", idPath, `{"closeReason":""}`)
	if clear.Code != 200 {
		t.Fatalf("clear: %d %s", clear.Code, clear.Body.String())
	}
	if err := json.Unmarshal(clear.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.CloseReason != "" {
		t.Fatalf("clear closeReason: %q", card.CloseReason)
	}
	// restore for status assertion below
	restore := request(h, "PATCH", idPath, `{"closeReason":"wont fix"}`)
	if restore.Code != 200 {
		t.Fatalf("restore: %d", restore.Code)
	}

	status := request(h, "PATCH", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10)+"/status", `{"status":"Doing"}`)
	if status.Code != 200 {
		t.Fatalf("status: %d %s", status.Code, status.Body.String())
	}
	var after Item
	if err := json.Unmarshal(status.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if after.CloseReason != "wont fix" {
		t.Fatalf("status move should keep reason: %q", after.CloseReason)
	}
}

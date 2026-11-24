package kanban

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// Attachment content never changes for an id, so it is cached for an hour and revalidated with an
// ETag; the permission check still runs on every request (#129).

func getContent(h http.Handler, number, id int64, ifNoneMatch string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", "/api/items/by-number/"+strconv.FormatInt(number, 10)+"/attachments/"+strconv.FormatInt(id, 10)+"/content", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func uploadedAttachment(t *testing.T) (http.Handler, *memoryRepo, Item, Attachment) {
	t.Helper()
	h, repo, _ := attachmentHandler(t)
	card, err := repo.CreateItem(t.Context(), ItemInput{Title: "img", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	w := postPNG(t, h, card.Number, "description", "pic.png", pngBytes(), nil)
	if w.Code != 201 {
		t.Fatalf("upload=%d %s", w.Code, w.Body)
	}
	var att Attachment
	if err = json.Unmarshal(w.Body.Bytes(), &att); err != nil {
		t.Fatal(err)
	}
	return h, repo, card, att
}

func TestAttachmentContentIsCachedForAnHourWithAnETag(t *testing.T) {
	h, _, card, att := uploadedAttachment(t)
	rec := getContent(h, card.Number, att.ID, "")
	if rec.Code != 200 {
		t.Fatalf("content=%d", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, max-age=3600" {
		t.Fatalf("Cache-Control=%q", got)
	}
	if got := rec.Header().Get("Vary"); got != "Cookie, Authorization" {
		t.Fatalf("Vary=%q", got)
	}
	want := `"` + strconv.FormatInt(att.ID, 10) + "-" + strconv.FormatInt(att.ByteSize, 10) + `"`
	if got := rec.Header().Get("ETag"); got != want {
		t.Fatalf("ETag=%q, want %q", got, want)
	}
}

func TestAttachmentContentAnswers304WithoutABodyWhenTheETagMatches(t *testing.T) {
	h, _, card, att := uploadedAttachment(t)
	etag := getContent(h, card.Number, att.ID, "").Header().Get("ETag")
	rec := getContent(h, card.Number, att.ID, etag)
	if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatalf("matching ETag: %d body=%d bytes", rec.Code, rec.Body.Len())
	}
	if rec.Header().Get("ETag") != etag || rec.Header().Get("Cache-Control") != "private, max-age=3600" || rec.Header().Get("Vary") != "Cookie, Authorization" || rec.Header().Get("Content-Type") != "" {
		t.Fatalf("304 headers: %v", rec.Header())
	}
	if other := getContent(h, card.Number, att.ID, `"0-0"`); other.Code != 200 || other.Body.Len() == 0 {
		t.Fatalf("different ETag: %d", other.Code)
	}
}

func TestAttachmentContent304DoesNotOpenTheBlob(t *testing.T) {
	h, repo, blobs := attachmentHandler(t)
	card, _ := repo.CreateItem(t.Context(), ItemInput{Title: "img", ColumnID: 1})
	w := postPNG(t, h, card.Number, "description", "pic.png", pngBytes(), nil)
	var att Attachment
	if err := json.Unmarshal(w.Body.Bytes(), &att); err != nil {
		t.Fatal(err)
	}
	etag := getContent(h, card.Number, att.ID, "").Header().Get("ETag")
	if err := blobs.Delete(t.Context(), attachmentObjectKey(card.ID, att.ID)); err != nil {
		t.Fatal(err)
	}
	if rec := getContent(h, card.Number, att.ID, etag); rec.Code != http.StatusNotModified {
		t.Fatalf("304 must not need the blob: %d", rec.Code)
	}
}

func TestAttachmentContentRevalidationStillChecksTheAttachmentAndTheCaller(t *testing.T) {
	h, repo, card, att := uploadedAttachment(t)
	etag := getContent(h, card.Number, att.ID, "").Header().Get("ETag")
	other, _ := repo.CreateItem(t.Context(), ItemInput{Title: "other", ColumnID: 1})
	if rec := getContent(h, other.Number, att.ID, etag); rec.Code != 404 {
		t.Fatalf("another item's attachment with a matching ETag=%d, want 404", rec.Code)
	}
	anon := httptest.NewRequest("GET", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10)+"/attachments/"+strconv.FormatInt(att.ID, 10)+"/content", nil)
	anon.Header.Set("If-None-Match", etag)
	anonRec := httptest.NewRecorder()
	h.ServeHTTP(anonRec, anon)
	if anonRec.Code != 401 && anonRec.Code != 403 {
		t.Fatalf("anonymous with a matching ETag=%d, want 401/403", anonRec.Code)
	}
	del := request(h, "DELETE", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10)+"/attachments/"+strconv.FormatInt(att.ID, 10), "")
	if del.Code != 204 {
		t.Fatalf("delete=%d", del.Code)
	}
	if rec := getContent(h, card.Number, att.ID, etag); rec.Code != 404 || rec.Header().Get("ETag") != "" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("deleted attachment with a matching ETag=%d %v, want an uncached 404", rec.Code, rec.Header())
	}
}

func TestAttachmentContentErrorsAreNotCached(t *testing.T) {
	h, repo, blobs := attachmentHandler(t)
	card, _ := repo.CreateItem(t.Context(), ItemInput{Title: "img", ColumnID: 1})
	var att Attachment
	if err := json.Unmarshal(postPNG(t, h, card.Number, "description", "pic.png", pngBytes(), nil).Body.Bytes(), &att); err != nil {
		t.Fatal(err)
	}
	if err := blobs.Delete(t.Context(), attachmentObjectKey(card.ID, att.ID)); err != nil {
		t.Fatal(err)
	}
	rec := getContent(h, card.Number, att.ID, "")
	if rec.Code != 404 || rec.Header().Get("ETag") != "" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing blob: %d %v", rec.Code, rec.Header())
	}
}

func TestEtagMatches(t *testing.T) {
	const etag = `"7-120"`
	for _, tc := range []struct {
		name, header string
		want         bool
	}{
		{"exact", `"7-120"`, true},
		{"weak form", `W/"7-120"`, true},
		{"in a list", `"1-2", "7-120"`, true},
		{"star", `*`, true},
		{"other size", `"7-121"`, false},
		{"unquoted", `7-120`, false},
		{"empty", ``, false},
		{"garbage", `,,`, false},
	} {
		if got := etagMatches(tc.header, etag); got != tc.want {
			t.Errorf("%s: etagMatches(%q)=%v, want %v", tc.name, tc.header, got, tc.want)
		}
	}
}

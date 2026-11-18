package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCommentCRUDAPI(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"c","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create item: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	base := "/api/items/by-number/" + strconv.FormatInt(card.Number, 10) + "/comments"

	empty := request(h, "GET", base, "")
	if empty.Code != 200 {
		t.Fatalf("empty list: %d %s", empty.Code, empty.Body.String())
	}
	var list struct {
		Comments []Comment `json:"comments"`
	}
	if err := json.Unmarshal(empty.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Comments) != 0 {
		t.Fatalf("want empty, got %d", len(list.Comments))
	}

	if w := request(h, "GET", "/api/items/by-number/99999/comments", ""); w.Code != 404 {
		t.Fatalf("missing item GET: %d", w.Code)
	}

	omitAuthor := request(h, "POST", base, `{"body":"first"}`)
	if omitAuthor.Code != 201 {
		t.Fatalf("post omit author: %d %s", omitAuthor.Code, omitAuthor.Body.String())
	}
	var first Comment
	if err := json.Unmarshal(omitAuthor.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.Author != "" || first.Body != "first" || first.ItemID != card.ID {
		t.Fatalf("first: %+v", first)
	}

	blankAuthor := request(h, "POST", base, `{"author":"  ","body":"second"}`)
	if blankAuthor.Code != 201 {
		t.Fatalf("blank author: %d %s", blankAuthor.Code, blankAuthor.Body.String())
	}
	var second Comment
	if err := json.Unmarshal(blankAuthor.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.Author != "" {
		t.Fatalf("blank author want \"\", got %q", second.Author)
	}

	named := request(h, "POST", base, `{"author":"Alice","body":"third"}`)
	if named.Code != 201 {
		t.Fatalf("named: %d %s", named.Code, named.Body.String())
	}

	listed := request(h, "GET", base, "")
	if listed.Code != 200 {
		t.Fatalf("list: %d", listed.Code)
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Comments) != 3 {
		t.Fatalf("list len: %d", len(list.Comments))
	}
	if list.Comments[0].Body != "first" || list.Comments[1].Body != "second" || list.Comments[2].Body != "third" {
		t.Fatalf("order: %+v", list.Comments)
	}

	longAuthor := strings.Repeat("あ", 61)
	if utf8.RuneCountInString(longAuthor) != 61 {
		t.Fatal("fixture")
	}
	if w := request(h, "POST", base, `{"author":"`+longAuthor+`","body":"x"}`); w.Code != 400 {
		t.Fatalf("long author: %d", w.Code)
	}
	controlAuthor, _ := json.Marshal(map[string]string{"author": "a\nb", "body": "x"})
	if w := request(h, "POST", base, string(controlAuthor)); w.Code != 400 {
		t.Fatalf("control author: %d", w.Code)
	}
	if w := request(h, "POST", base, `{"body":""}`); w.Code != 400 {
		t.Fatalf("empty body: %d", w.Code)
	}
	if w := request(h, "POST", base, `{"body":"   "}`); w.Code != 400 {
		t.Fatalf("blank body: %d", w.Code)
	}
	longBody := strings.Repeat("あ", 4001)
	bodyPayload, _ := json.Marshal(map[string]string{"body": longBody})
	if w := request(h, "POST", base, string(bodyPayload)); w.Code != 400 {
		t.Fatalf("long body: %d", w.Code)
	}
	controlBody, _ := json.Marshal(map[string]string{"body": "a\tb"})
	if w := request(h, "POST", base, string(controlBody)); w.Code != 400 {
		t.Fatalf("control body: %d", w.Code)
	}

	path := base + "/" + strconv.FormatInt(first.ID, 10)
	if w := request(h, "PATCH", path, `{}`); w.Code != 400 {
		t.Fatalf("empty patch: %d", w.Code)
	}
	if w := request(h, "PATCH", path, `{"body":null}`); w.Code != 400 {
		t.Fatalf("null body: %d", w.Code)
	}
	if w := request(h, "PATCH", path, `{"author":null}`); w.Code != 400 {
		t.Fatalf("null author: %d", w.Code)
	}
	if w := request(h, "PATCH", path, `{"body":""}`); w.Code != 400 {
		t.Fatalf("empty body patch: %d", w.Code)
	}

	bodyOnly := request(h, "PATCH", path, `{"body":"first-edited"}`)
	if bodyOnly.Code != 200 {
		t.Fatalf("body only: %d %s", bodyOnly.Code, bodyOnly.Body.String())
	}
	var edited Comment
	if err := json.Unmarshal(bodyOnly.Body.Bytes(), &edited); err != nil {
		t.Fatal(err)
	}
	if edited.Body != "first-edited" || edited.Author != "" {
		t.Fatalf("body only result: %+v", edited)
	}

	authorOnly := request(h, "PATCH", path, `{"author":"Bob"}`)
	if authorOnly.Code != 200 {
		t.Fatalf("author only: %d %s", authorOnly.Code, authorOnly.Body.String())
	}
	if err := json.Unmarshal(authorOnly.Body.Bytes(), &edited); err != nil {
		t.Fatal(err)
	}
	if edited.Author != "Bob" || edited.Body != "first-edited" {
		t.Fatalf("author only result: %+v", edited)
	}

	clearAuthor := request(h, "PATCH", path, `{"author":"  "}`)
	if clearAuthor.Code != 200 {
		t.Fatalf("clear author: %d", clearAuthor.Code)
	}
	if err := json.Unmarshal(clearAuthor.Body.Bytes(), &edited); err != nil {
		t.Fatal(err)
	}
	if edited.Author != "" {
		t.Fatalf("clear author: %q", edited.Author)
	}

	other := request(h, "POST", "/api/items", `{"title":"o","description":"d","columnId":1}`)
	if other.Code != 201 {
		t.Fatalf("other item: %d", other.Code)
	}
	var otherCard Item
	if err := json.Unmarshal(other.Body.Bytes(), &otherCard); err != nil {
		t.Fatal(err)
	}
	otherBase := "/api/items/by-number/" + strconv.FormatInt(otherCard.Number, 10) + "/comments"
	wrong := request(h, "PATCH", otherBase+"/"+strconv.FormatInt(first.ID, 10), `{"body":"nope"}`)
	if wrong.Code != 404 {
		t.Fatalf("cross item patch: %d", wrong.Code)
	}
	wrongDel := request(h, "DELETE", otherBase+"/"+strconv.FormatInt(first.ID, 10), "")
	if wrongDel.Code != 404 {
		t.Fatalf("cross item delete: %d", wrongDel.Code)
	}

	del := request(h, "DELETE", path, "")
	if del.Code != 204 {
		t.Fatalf("delete: %d %s", del.Code, del.Body.String())
	}
	listed = request(h, "GET", base, "")
	if err := json.Unmarshal(listed.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Comments) != 2 {
		t.Fatalf("after delete: %d", len(list.Comments))
	}

	delItem := request(h, "DELETE", "/api/items/"+strconv.FormatInt(card.ID, 10), "")
	if delItem.Code != 204 {
		t.Fatalf("delete item: %d", delItem.Code)
	}
	if w := request(h, "GET", base, ""); w.Code != 404 {
		t.Fatalf("comments after item delete: %d", w.Code)
	}
}

func TestNormalizeCommentFields(t *testing.T) {
	if v, ok := NormalizeCommentAuthor("  "); !ok || v != "" {
		t.Fatalf("blank author: %q %v", v, ok)
	}
	if _, ok := NormalizeCommentAuthor(strings.Repeat("x", 61)); ok {
		t.Fatal("long author")
	}
	if _, ok := NormalizeCommentAuthor("a\nb"); ok {
		t.Fatal("control author")
	}
	if _, ok := NormalizeCommentBody(""); ok {
		t.Fatal("empty body")
	}
	if _, ok := NormalizeCommentBody(strings.Repeat("y", 4001)); ok {
		t.Fatal("long body")
	}
	if v, ok := NormalizeCommentBody("  hi  "); !ok || v != "hi" {
		t.Fatalf("trim body: %q %v", v, ok)
	}
	if v, ok := NormalizeCommentBody("line1\nline2"); !ok || v != "line1\nline2" {
		t.Fatalf("newline body: %q %v", v, ok)
	}
	if _, ok := NormalizeCommentBody("a\tb"); ok {
		t.Fatal("tab body")
	}
}

func TestCommentAPIUnknownAndPath(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"c","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create: %d", created.Code)
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	base := "/api/items/by-number/" + strconv.FormatInt(card.Number, 10) + "/comments"
	if w := request(h, "POST", base, `{"body":"x","extra":1}`); w.Code != 400 {
		t.Fatalf("unknown post: %d", w.Code)
	}
	post := request(h, "POST", base, `{"body":"ok"}`)
	if post.Code != 201 {
		t.Fatalf("post: %d", post.Code)
	}
	var c Comment
	if err := json.Unmarshal(post.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "PATCH", base+"/"+strconv.FormatInt(c.ID, 10), `{"body":"y","extra":true}`); w.Code != 400 {
		t.Fatalf("unknown patch: %d", w.Code)
	}
	if w := request(h, "PATCH", base+"/0", `{"body":"y"}`); w.Code != 400 {
		t.Fatalf("id 0: %d", w.Code)
	}
	if w := request(h, "DELETE", base+"/abc", ""); w.Code != 400 {
		t.Fatalf("id abc: %d", w.Code)
	}
	multi, _ := json.Marshal(map[string]string{"body": "a\nb"})
	if w := request(h, "POST", base, string(multi)); w.Code != 201 {
		t.Fatalf("newline body: %d %s", w.Code, w.Body.String())
	}
}

package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
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
	if first.Author != "admin" || first.Body != "first" || first.ItemID != card.ID {
		t.Fatalf("first: %+v", first)
	}
	if first.CreatedByUserID == nil || *first.CreatedByUserID != 1 {
		t.Fatalf("createdBy: %+v", first.CreatedByUserID)
	}

	if w := request(h, "POST", base, `{"author":"Alice","body":"second"}`); w.Code != 400 {
		t.Fatalf("spoof author: %d", w.Code)
	}
	secondPost := request(h, "POST", base, `{"body":"second"}`)
	if secondPost.Code != 201 {
		t.Fatalf("second: %d %s", secondPost.Code, secondPost.Body.String())
	}
	var second Comment
	if err := json.Unmarshal(secondPost.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.Author != "admin" {
		t.Fatalf("second author: %q", second.Author)
	}

	thirdPost := request(h, "POST", base, `{"body":"third"}`)
	if thirdPost.Code != 201 {
		t.Fatalf("third: %d", thirdPost.Code)
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

	if w := request(h, "POST", base, `{"author":"Alice","body":"x"}`); w.Code != 400 {
		t.Fatalf("author field rejected: %d", w.Code)
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
	if w := request(h, "PATCH", path, `{"author":"Bob"}`); w.Code != 400 {
		t.Fatalf("author patch rejected: %d", w.Code)
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
	if edited.Body != "first-edited" || edited.Author != "admin" {
		t.Fatalf("body only result: %+v", edited)
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

func TestCommentOwnershipDeniesOtherUser(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	card, _ := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "c", Description: "d"})
	base := "/api/items/by-number/" + strconv.FormatInt(card.Number, 10) + "/comments"

	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "bob", DisplayName: "Bob", Password: "member-pass", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	repo.sessions["bob-session"] = Session{ID: "bob-session", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}

	adminPost := request(h, "POST", base, `{"body":"from-admin"}`)
	if adminPost.Code != 201 {
		t.Fatalf("admin post: %d", adminPost.Code)
	}
	var c Comment
	if err := json.Unmarshal(adminPost.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	path := base + "/" + strconv.FormatInt(c.ID, 10)

	if w := requestWithCookie(h, "PATCH", path, `{"body":"hacked"}`, "bob-session"); w.Code != 403 {
		t.Fatalf("member patch other: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithCookie(h, "DELETE", path, "", "bob-session"); w.Code != 403 {
		t.Fatalf("member delete other: %d", w.Code)
	}

	bobPost := requestWithCookie(h, "POST", base, `{"body":"from-bob"}`, "bob-session")
	if bobPost.Code != 201 {
		t.Fatalf("bob post: %d %s", bobPost.Code, bobPost.Body.String())
	}
	var bobComment Comment
	if err := json.Unmarshal(bobPost.Body.Bytes(), &bobComment); err != nil {
		t.Fatal(err)
	}
	if bobComment.Author != "Bob" {
		t.Fatalf("bob author snapshot: %q", bobComment.Author)
	}
	bobPath := base + "/" + strconv.FormatInt(bobComment.ID, 10)
	if w := requestWithCookie(h, "PATCH", bobPath, `{"body":"bob-edited"}`, "bob-session"); w.Code != 200 {
		t.Fatalf("bob self patch: %d", w.Code)
	}
	if w := request(h, "PATCH", bobPath, `{"body":"admin-over"}`); w.Code != 200 {
		t.Fatalf("admin patch any comment: %d %s", w.Code, w.Body.String())
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

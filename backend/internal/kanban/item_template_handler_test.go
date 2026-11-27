package kanban

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestItemTemplatesSeedOnEmptyList(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "GET", "/api/item-templates?projectId=1", "")
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Templates []ItemTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	seeds := defaultItemTemplateSeeds()
	if len(out.Templates) != len(seeds) {
		t.Fatalf("got %d want %d", len(out.Templates), len(seeds))
	}
	for i, seed := range seeds {
		got := out.Templates[i]
		if got.Name != seed.Name || got.TitleTemplate != seed.TitleTemplate || got.DescriptionTemplate != seed.DescriptionTemplate {
			t.Fatalf("seed[%d]=%+v want name/title/desc %+v", i, got, seed)
		}
		if got.ProjectID != 1 || got.Position != i {
			t.Fatalf("seed[%d] project/pos %+v", i, got)
		}
	}
	w = request(h, "GET", "/api/item-templates?projectId=1", "")
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || len(out.Templates) != 2 {
		t.Fatalf("second list: n=%d err=%v", len(out.Templates), err)
	}
}

func TestItemTemplatesNoReseedWhenOneExists(t *testing.T) {
	r := fresh()
	r.itemTemplates = []ItemTemplate{{
		ID: 9, ProjectID: 1, Name: "独自", TitleTemplate: "t", DescriptionTemplate: "d", Position: 0,
	}}
	r.nextItemTemplateID = 10
	h := NewHandler(r)
	w := request(h, "GET", "/api/item-templates?projectId=1", "")
	var out struct {
		Templates []ItemTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || len(out.Templates) != 1 || out.Templates[0].Name != "独自" {
		t.Fatalf("got %+v", out.Templates)
	}
}

func TestItemTemplatesSeedFailureIs500(t *testing.T) {
	r := fresh()
	r.itemTemplateSeedFail = errors.New("seed boom")
	h := NewHandler(r)
	w := request(h, "GET", "/api/item-templates?projectId=1", "")
	if w.Code != 500 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestItemTemplatesEnsureSeedsIdempotent(t *testing.T) {
	r := fresh()
	if err := r.EnsureItemTemplateSeeds(t.Context(), 1); err != nil {
		t.Fatal(err)
	}
	if err := r.EnsureItemTemplateSeeds(t.Context(), 1); err != nil {
		t.Fatal(err)
	}
	list, err := r.ListItemTemplates(t.Context(), 1)
	if err != nil || len(list) != 2 {
		t.Fatalf("n=%d err=%v", len(list), err)
	}
}

func TestItemTemplatesCRUDAndScope(t *testing.T) {
	r := fresh()
	p2, err := r.CreateProject(t.Context(), "他")
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(r)

	w := request(h, "POST", "/api/item-templates?projectId=1",
		`{"name":"手順","titleTemplate":"[手順] ","descriptionTemplate":"## 手順\n"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created ItemTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == 0 {
		t.Fatalf("created %+v", created)
	}

	w = request(h, "PATCH", "/api/item-templates/"+itoa(created.ID)+"?projectId="+itoa(p2.ID),
		`{"name":"盗む"}`)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 404, "テンプレートが見つかりません。")

	w = request(h, "PATCH", "/api/item-templates/"+itoa(created.ID)+"?projectId=1",
		`{"name":"手順2"}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d %s", w.Code, w.Body.String())
	}

	w = request(h, "DELETE", "/api/item-templates/"+itoa(created.ID)+"?projectId="+itoa(p2.ID), "")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 404, "テンプレートが見つかりません。")

	w = request(h, "DELETE", "/api/item-templates/"+itoa(created.ID)+"?projectId=1", "")
	if w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestItemTemplatesValidation(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	path := "/api/item-templates?projectId=1"
	cases := []struct {
		body string
		code int
	}{
		{`{}`, 400},
		{`{"name":"","titleTemplate":"t","descriptionTemplate":""}`, 400},
		{`{"name":"a","titleTemplate":"","descriptionTemplate":""}`, 400},
		{`{"name":"a","titleTemplate":"` + strings.Repeat("あ", 201) + `","descriptionTemplate":""}`, 400},
		{`{"name":"a","titleTemplate":"t","descriptionTemplate":"` + strings.Repeat("あ", 10001) + `"}`, 400},
		{`{"name":"a","titleTemplate":"t","descriptionTemplate":"","extra":1}`, 400},
		{`{"name":"a","titleTemplate":"t","descriptionTemplate":"","position":9}`, 400},
	}
	for _, tc := range cases {
		w := request(h, "POST", path, tc.body)
		if w.Code != tc.code {
			t.Fatalf("%s -> %d want %d (%s)", tc.body[:min(60, len(tc.body))], w.Code, tc.code, w.Body.String())
		}
	}
	w := request(h, "PATCH", "/api/item-templates/1?projectId=1", `{}`)
	if w.Code != 400 {
		t.Fatalf("empty patch: %d", w.Code)
	}
	w = request(h, "PATCH", "/api/item-templates/1?projectId=1", `{"position":1}`)
	if w.Code != 400 {
		t.Fatalf("position patch: %d", w.Code)
	}
	w = request(h, "GET", "/api/item-templates", "")
	if w.Code != 400 {
		t.Fatalf("missing projectId: %d", w.Code)
	}
	w = request(h, "GET", "/api/item-templates?projectId=999", "")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 404, "プロジェクトが見つかりません。")
}

func TestItemTemplatesNonAdminForbidden(t *testing.T) {
	r := fresh()
	memberHash, err := HashPassword("member-pass")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	r.users = append(r.users, User{
		ID: 2, LoginName: "member", DisplayName: "member",
		PasswordHash: memberHash, Role: RoleMember,
	})
	r.sessions["member-session"] = Session{ID: "member-session", UserID: 2, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	h := NewHandler(r)

	// Seed one template as admin so PATCH/DELETE have a target.
	w := request(h, "POST", "/api/item-templates?projectId=1",
		`{"name":"keep","titleTemplate":"t","descriptionTemplate":""}`)
	if w.Code != 201 {
		t.Fatalf("admin create: %d %s", w.Code, w.Body.String())
	}
	var created ItemTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == 0 {
		t.Fatalf("created %+v", created)
	}

	body := `{"name":"x","titleTemplate":"t","descriptionTemplate":""}`
	w = requestWithCookie(h, "POST", "/api/item-templates?projectId=1", body, "member-session")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
	w = requestWithCookie(h, "PATCH", "/api/item-templates/"+itoa(created.ID)+"?projectId=1",
		`{"name":"stolen"}`, "member-session")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
	w = requestWithCookie(h, "DELETE", "/api/item-templates/"+itoa(created.ID)+"?projectId=1", "", "member-session")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)

	list, err := r.ListItemTemplates(t.Context(), 1)
	if err != nil || len(list) != 1 || list[0].Name != "keep" {
		t.Fatalf("catalog after member writes: %+v err=%v", list, err)
	}
}

func TestItemTemplatesUnauthorized(t *testing.T) {
	h := NewHandler(fresh())
	w := requestAnon(h, "GET", "/api/item-templates?projectId=1", "")
	if w.Code != 401 {
		t.Fatalf("anon GET: %d %s", w.Code, w.Body.String())
	}
	w = requestAnon(h, "POST", "/api/item-templates?projectId=1",
		`{"name":"x","titleTemplate":"t","descriptionTemplate":""}`)
	if w.Code != 401 {
		t.Fatalf("anon POST: %d %s", w.Code, w.Body.String())
	}
}

func TestItemTemplateDeleteKeepsItemBody(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "POST", "/api/item-templates?projectId=1",
		`{"name":"型","titleTemplate":"題","descriptionTemplate":"本文"}`)
	if w.Code != 201 {
		t.Fatalf("create template: %d", w.Code)
	}
	var tmpl ItemTemplate
	_ = json.Unmarshal(w.Body.Bytes(), &tmpl)

	w = request(h, "POST", "/api/items", `{"title":"題","description":"本文","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create item: %d %s", w.Code, w.Body.String())
	}
	var item Item
	_ = json.Unmarshal(w.Body.Bytes(), &item)

	w = request(h, "DELETE", "/api/item-templates/"+itoa(tmpl.ID)+"?projectId=1", "")
	if w.Code != 204 {
		t.Fatalf("delete template: %d", w.Code)
	}
	got, err := r.GetItem(t.Context(), item.ID)
	if err != nil || got.Title != "題" || got.Description != "本文" {
		t.Fatalf("item after delete: %+v err=%v", got, err)
	}
}

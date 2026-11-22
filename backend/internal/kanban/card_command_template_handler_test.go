package kanban

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCardCommandTemplatesHTTP(t *testing.T) {
	h := NewHandler(fresh())

	w := request(h, "POST", "/api/items", `{"title":"A","description":"","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create card: %d %s", w.Code, w.Body.String())
	}
	var card Item
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}

	w = request(h, "GET", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", "")
	if w.Code != 200 {
		t.Fatalf("get empty: %d %s", w.Code, w.Body.String())
	}
	var empty struct {
		Templates []CommandTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty.Templates) != 0 {
		t.Fatalf("want empty, got %+v", empty.Templates)
	}

	w = request(h, "GET", "/api/items/by-number/99999/command-templates", "")
	if w.Code != 404 {
		t.Fatalf("missing card get: %d", w.Code)
	}

	w = request(h, "POST", "/api/command-templates", `{"name":"gh","template":"gh pr view {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("create template: %d %s", w.Code, w.Body.String())
	}
	var tmpl CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &tmpl); err != nil {
		t.Fatal(err)
	}

	w = request(h, "PUT", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", `{"templateIds":[`+itoa(tmpl.ID)+`,`+itoa(tmpl.ID)+`]}`)
	if w.Code != 200 {
		t.Fatalf("put card: %d %s", w.Code, w.Body.String())
	}
	var linked struct {
		Templates []CommandTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if len(linked.Templates) != 1 || linked.Templates[0].ID != tmpl.ID {
		t.Fatalf("dedupe link: %+v", linked.Templates)
	}

	w = request(h, "PUT", "/api/items/by-number/99999/command-templates", `{"templateIds":[]}`)
	if w.Code != 404 {
		t.Fatalf("missing card put: %d", w.Code)
	}

	w = request(h, "PUT", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", `{"templateIds":[999999]}`)
	if w.Code != 400 {
		t.Fatalf("unknown id: %d %s", w.Code, w.Body.String())
	}

	w = request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(tmpl.ID)+`]}`)
	if w.Code != 200 {
		t.Fatalf("put defaults: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "GET", "/api/command-template-defaults", "")
	if w.Code != 200 {
		t.Fatalf("get defaults: %d", w.Code)
	}
	var defaults struct {
		TemplateIDs []int64 `json:"templateIds"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &defaults); err != nil {
		t.Fatal(err)
	}
	if len(defaults.TemplateIDs) != 1 || defaults.TemplateIDs[0] != tmpl.ID {
		t.Fatalf("defaults=%+v", defaults.TemplateIDs)
	}

	w = request(h, "POST", "/api/items", `{"title":"B","description":"","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create B: %d %s", w.Code, w.Body.String())
	}
	var cardB Item
	if err := json.Unmarshal(w.Body.Bytes(), &cardB); err != nil {
		t.Fatal(err)
	}
	w = request(h, "GET", "/api/items/by-number/"+itoa(cardB.Number)+"/command-templates", "")
	if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if len(linked.Templates) != 1 || linked.Templates[0].ID != tmpl.ID {
		t.Fatalf("copied defaults: %+v", linked.Templates)
	}

	w = request(h, "POST", "/api/command-templates", `{"name":"echo","template":"echo {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("create echo: %d", w.Code)
	}
	var echo CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &echo); err != nil {
		t.Fatal(err)
	}

	w = request(h, "POST", "/api/command-templates/apply-to-all-items", `{"templateIds":[`+itoa(echo.ID)+`]}`)
	if w.Code != 204 {
		t.Fatalf("apply: %d %s", w.Code, w.Body.String())
	}
	for _, n := range []int64{card.Number, cardB.Number} {
		w = request(h, "GET", "/api/items/by-number/"+itoa(n)+"/command-templates", "")
		if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
			t.Fatal(err)
		}
		if len(linked.Templates) != 1 || linked.Templates[0].ID != echo.ID {
			t.Fatalf("card %d after apply: %+v", n, linked.Templates)
		}
	}
}

func TestDefaultsAndApplyRejectUnknownIDs(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[999999]}`)
	if w.Code != 400 {
		t.Fatalf("defaults unknown: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "POST", "/api/command-templates/apply-to-all-items", `{"templateIds":[999999]}`)
	if w.Code != 400 {
		t.Fatalf("apply unknown: %d %s", w.Code, w.Body.String())
	}
}

func TestDecodeTemplateIDsRequiresField(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "PUT", "/api/command-template-defaults", `{}`)
	if w.Code != 400 {
		t.Fatalf("omit templateIds: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "PUT", "/api/command-template-defaults", `{"templateIds":null}`)
	if w.Code != 400 {
		t.Fatalf("null templateIds: %d %s", w.Code, w.Body.String())
	}
}

func TestApplyEmptyClearsAllCardsAndDeleteRemovesLinks(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "POST", "/api/command-templates", `{"name":"a","template":"echo {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("create template: %d", w.Code)
	}
	var tmpl CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &tmpl); err != nil {
		t.Fatal(err)
	}
	w = request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(tmpl.ID)+`]}`)
	if w.Code != 200 {
		t.Fatalf("defaults: %d", w.Code)
	}
	w = request(h, "POST", "/api/items", `{"title":"A","description":"","columnId":1}`)
	if w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	var card Item
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	w = request(h, "POST", "/api/command-templates/apply-to-all-items", `{"templateIds":[]}`)
	if w.Code != 204 {
		t.Fatalf("empty apply: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "GET", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", "")
	var linked struct {
		Templates []CommandTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if len(linked.Templates) != 0 {
		t.Fatalf("want cleared, got %+v", linked.Templates)
	}

	w = request(h, "PUT", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", `{"templateIds":[`+itoa(tmpl.ID)+`]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(tmpl.ID)+`]}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = request(h, "DELETE", "/api/command-templates/"+itoa(tmpl.ID), "")
	if w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
	w = request(h, "GET", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", "")
	if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if len(linked.Templates) != 0 {
		t.Fatalf("links after delete: %+v", linked.Templates)
	}
	w = request(h, "GET", "/api/command-template-defaults", "")
	var defaults struct {
		TemplateIDs []int64 `json:"templateIds"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &defaults); err != nil {
		t.Fatal(err)
	}
	if len(defaults.TemplateIDs) != 0 {
		t.Fatalf("defaults after delete: %+v", defaults.TemplateIDs)
	}
}

func TestCommandTemplateDefaultsAndApplyAdminGuards(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := request(h, "POST", "/api/command-templates", `{"name":"a","template":"a {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("seed tmpl: %d %s", w.Code, w.Body.String())
	}
	var tmpl CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &tmpl); err != nil {
		t.Fatal(err)
	}
	w = request(h, "POST", "/api/items", `{"title":"A","description":"","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("seed card: %d %s", w.Code, w.Body.String())
	}
	var card Item
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}

	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "mem-ct2", Password: "password1", DisplayName: "Mem", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(t.Context(), member.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	w = requestWithCookie(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(tmpl.ID)+`]}`, sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
	w = request(h, "GET", "/api/command-template-defaults", "")
	if w.Code != 200 {
		t.Fatalf("get defaults: %d", w.Code)
	}
	var defaults struct {
		TemplateIDs []int64 `json:"templateIds"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &defaults); err != nil {
		t.Fatal(err)
	}
	if len(defaults.TemplateIDs) != 0 {
		t.Fatalf("defaults changed: %+v", defaults.TemplateIDs)
	}

	w = requestWithCookie(h, "POST", "/api/command-templates/apply-to-all-items", `{"templateIds":[`+itoa(tmpl.ID)+`]}`, sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
	w = request(h, "GET", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", "")
	if w.Code != 200 {
		t.Fatalf("get card tmpl: %d", w.Code)
	}
	var linked struct {
		Templates []CommandTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &linked); err != nil {
		t.Fatal(err)
	}
	if len(linked.Templates) != 0 {
		t.Fatalf("card templates changed: %+v", linked.Templates)
	}
}

func TestDefaultsChangeDoesNotAlterExistingCard(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "POST", "/api/command-templates", `{"name":"a","template":"a {{url}}"}`)
	var a CommandTemplate
	_ = json.Unmarshal(w.Body.Bytes(), &a)
	w = request(h, "POST", "/api/command-templates", `{"name":"b","template":"b {{url}}"}`)
	var b CommandTemplate
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(a.ID)+`]}`)
	w = request(h, "POST", "/api/items", `{"title":"A","description":"","columnId":1}`)
	var card Item
	_ = json.Unmarshal(w.Body.Bytes(), &card)
	request(h, "PUT", "/api/command-template-defaults", `{"templateIds":[`+itoa(b.ID)+`]}`)
	w = request(h, "GET", "/api/items/by-number/"+itoa(card.Number)+"/command-templates", "")
	var linked struct {
		Templates []CommandTemplate `json:"templates"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &linked)
	if len(linked.Templates) != 1 || linked.Templates[0].ID != a.ID {
		t.Fatalf("existing should keep a, got %+v", linked.Templates)
	}
}
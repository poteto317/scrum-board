package kanban

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCommandTemplatesCRUD(t *testing.T) {
	r := fresh()
	h := NewHandler(r)

	w := request(h, "GET", "/api/command-templates", "")
	if w.Code != 200 {
		t.Fatalf("list empty: %d %s", w.Code, w.Body.String())
	}

	w = request(h, "POST", "/api/command-templates", `{"name":"gh","template":"gh pr view {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == 0 || created.Name != "gh" {
		t.Fatalf("created: %+v err=%v", created, err)
	}

	w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), `{"name":"gh2"}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d", w.Code)
	}

	w = request(h, "DELETE", "/api/command-templates/"+itoa(created.ID), "")
	if w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestCommandTemplatesValidation(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	cases := []struct {
		body string
		code int
	}{
		{`{}`, 400},
		{`{"name":"","template":"x"}`, 400},
		{`{"name":"a","template":""}`, 400},
		{`{"name":1,"template":"x"}`, 400},
		{`{"name":"a","template":"x","extra":1}`, 400},
		{`{"name":null,"template":"x"}`, 400},
	}
	for _, tc := range cases {
		w := request(h, "POST", "/api/command-templates", tc.body)
		if w.Code != tc.code {
			t.Fatalf("%s -> %d want %d (%s)", tc.body, w.Code, tc.code, w.Body.String())
		}
	}
	control, _ := json.Marshal(map[string]string{"name": "ok", "template": "a\tb"})
	w := request(h, "POST", "/api/command-templates", string(control))
	if w.Code != 400 {
		t.Fatalf("control: %d", w.Code)
	}
	w = request(h, "PATCH", "/api/command-templates/1", `{}`)
	if w.Code != 400 {
		t.Fatalf("empty patch: %d", w.Code)
	}
	w = request(h, "DELETE", "/api/command-templates/999", "")
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 404, "テンプレートが見つかりません。")
	w = request(h, "PATCH", "/api/command-templates/999", `{"name":"gone"}`)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 404, "テンプレートが見つかりません。")
	for _, id := range []string{"0", "-1", "abc"} {
		for _, method := range []string{"DELETE", "PATCH"} {
			w = request(h, method, "/api/command-templates/"+id, `{"name":"x"}`)
			assertAPIMessage(t, w.Code, w.Body.Bytes(), 400, "テンプレートIDが不正です。")
		}
	}
}

func TestCommandTemplatesNormalizeHTTP(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "POST", "/api/command-templates", `{"name":"  hello  ","template":"  x  "}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "hello" || created.Template != "  x  " {
		t.Fatalf("normalized create: %+v", created)
	}
	control, _ := json.Marshal(map[string]string{"name": "a\nb"})
	rejects := []string{
		string(control),
		`{"name":""}`,
		`{"template":1}`,
	}
	for _, body := range rejects {
		w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), body)
		if w.Code != 400 {
			t.Fatalf("%s -> %d (%s)", body, w.Code, w.Body.String())
		}
	}
	w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), `{"name":"  trimmed  "}`)
	if w.Code != 200 {
		t.Fatalf("name only: %d %s", w.Code, w.Body.String())
	}
	var updated CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "trimmed" || updated.Template != "  x  " {
		t.Fatalf("trimmed name: %+v", updated)
	}
}

func TestCommandTemplatesPatchNull(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "POST", "/api/command-templates", `{"name":"gh","template":"keep"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == 0 {
		t.Fatalf("created: %+v err=%v", created, err)
	}
	cases := []string{
		`{"name":null}`,
		`{"name":null,"template":"x"}`,
		`{"template":null}`,
	}
	for _, body := range cases {
		w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), body)
		if w.Code != 400 {
			t.Fatalf("%s -> %d (%s)", body, w.Code, w.Body.String())
		}
	}
	w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), `{"template":"x"}`)
	if w.Code != 200 {
		t.Fatalf("template only: %d %s", w.Code, w.Body.String())
	}
	var updated CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "gh" || updated.Template != "x" {
		t.Fatalf("partial update: %+v", updated)
	}
}

func TestCommandTemplatesLimit(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	for i := 0; i < MaxCommandTemplates; i++ {
		body := fmt.Sprintf(`{"name":"n%d","template":"t%d"}`, i, i)
		w := request(h, "POST", "/api/command-templates", body)
		if w.Code != 201 {
			t.Fatalf("seed %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	w := request(h, "POST", "/api/command-templates", `{"name":"overflow","template":"x"}`)
	if w.Code != 400 {
		t.Fatalf("limit: %d %s", w.Code, w.Body.String())
	}
}

func TestCommandTemplatesAdminGuards(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := request(h, "POST", "/api/command-templates", `{"name":"safe","template":"echo {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("seed: %d %s", w.Code, w.Body.String())
	}
	var seeded CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &seeded); err != nil {
		t.Fatal(err)
	}

	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "mem-ct", Password: "password1", DisplayName: "Mem", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(t.Context(), member.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	w = requestWithCookie(h, "POST", "/api/command-templates", `{"name":"evil","template":"rm -rf /"}`, sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)

	w = request(h, "GET", "/api/command-templates", "")
	if w.Code != 200 {
		t.Fatalf("list after post: %d", w.Code)
	}
	var list struct {
		Templates []CommandTemplate `json:"templates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Templates) != 1 || list.Templates[0].Template != "echo {{url}}" {
		t.Fatalf("catalog changed after member post: %+v", list.Templates)
	}

	w = requestWithCookie(h, "PATCH", "/api/command-templates/"+itoa(seeded.ID), `{"template":"curl evil"}`, sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
	w = requestWithCookie(h, "DELETE", "/api/command-templates/"+itoa(seeded.ID), "", sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)

	w = request(h, "GET", "/api/command-templates", "")
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Templates) != 1 || list.Templates[0].Template != "echo {{url}}" {
		t.Fatalf("catalog changed after member patch/delete: %+v", list.Templates)
	}
	if !strings.Contains(list.Templates[0].Name, "safe") {
		t.Fatalf("name changed: %+v", list.Templates[0])
	}
}

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}

func assertAPIMessage(t *testing.T, code int, body []byte, wantCode int, want string) {
	t.Helper()
	if code != wantCode {
		t.Fatalf("status %d want %d (%s)", code, wantCode, body)
	}
	var msg struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &msg); err != nil {
		t.Fatalf("message json: %v body=%s", err, body)
	}
	if msg.Message != want {
		t.Fatalf("message %q want %q", msg.Message, want)
	}
}

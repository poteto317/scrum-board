package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestUsersAPIListCreatePatch(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := request(h, "GET", "/api/users", "")
	if w.Code != 200 {
		t.Fatalf("list=%d %s", w.Code, w.Body)
	}
	var list []UserPublic
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].LoginName != "admin" {
		t.Fatalf("list=%#v", list)
	}
	if strings.Contains(w.Body.String(), "passwordHash") || strings.Contains(w.Body.String(), "$2a$") {
		t.Fatal("list leaked password")
	}

	w = request(h, "POST", "/api/users", `{"loginName":"bob","password":"secret-bob","displayName":"Bob"}`)
	if w.Code != 201 {
		t.Fatalf("create=%d %s", w.Code, w.Body)
	}
	var bob UserPublic
	if err := json.Unmarshal(w.Body.Bytes(), &bob); err != nil {
		t.Fatal(err)
	}
	if bob.Role != RoleMember || bob.DisplayName != "Bob" {
		t.Fatalf("bob=%#v", bob)
	}

	w = request(h, "POST", "/api/users", `{"loginName":"bob","password":"x","displayName":"X"}`)
	if w.Code != 409 {
		t.Fatalf("dup=%d", w.Code)
	}
	w = request(h, "POST", "/api/users", `{"loginName":"","password":"x","displayName":"X"}`)
	if w.Code != 400 {
		t.Fatalf("missing=%d", w.Code)
	}

	w = request(h, "PATCH", "/api/users/"+strconv.FormatInt(bob.ID, 10), `{"displayName":"Bobby","role":"admin"}`)
	if w.Code != 200 {
		t.Fatalf("patch=%d %s", w.Code, w.Body)
	}
}

func TestUsersAPIAdminGuards(t *testing.T) {
	repo := fresh()
	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "mem", Password: "password1", DisplayName: "Mem", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(t.Context(), member.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(repo)

	w := requestWithCookie(h, "POST", "/api/users", `{"loginName":"x","password":"password1","displayName":"X"}`, sess.ID)
	if w.Code != 403 {
		t.Fatalf("member create=%d", w.Code)
	}
	w = requestWithCookie(h, "PATCH", "/api/users/1", `{"displayName":"A"}`, sess.ID)
	if w.Code != 403 {
		t.Fatalf("member patch=%d", w.Code)
	}

	w = request(h, "PATCH", "/api/users/1", `{"disabled":true}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), msgSelfDisable) {
		t.Fatalf("self disable=%d %s", w.Code, w.Body)
	}

	w = request(h, "PATCH", "/api/users/1", `{"role":"member"}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), msgLastAdmin) {
		t.Fatalf("last admin demote=%d %s", w.Code, w.Body)
	}

	admin2, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "a2", Password: "password1", DisplayName: "A2", Role: RoleAdmin,
	})
	if err != nil {
		t.Fatal(err)
	}
	dis := true
	if _, err := repo.UpdateUser(t.Context(), admin2.ID, UserPatch{Disabled: &dis}, 1); err != nil {
		t.Fatal(err)
	}
	w = request(h, "PATCH", "/api/users/1", `{"role":"member"}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), msgLastAdmin) {
		t.Fatalf("last admin demote after other disabled=%d %s", w.Code, w.Body)
	}
}

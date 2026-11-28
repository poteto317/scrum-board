package kanban

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestLabelCRUDEndpoints(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	member, err := repo.CreateUser(context.Background(), UserCreateInput{
		LoginName: "label-member", DisplayName: "Member", Password: "member-pass-123", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.sessions["member-session"] = Session{ID: "member-session", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	h := NewHandler(repo)

	// Unauthenticated -> 401.
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/labels", ""},
		{"POST", "/api/labels", `{"name":"bug","color":"#ef4444"}`},
		{"PATCH", "/api/labels/1", `{"name":"bug2"}`},
		{"DELETE", "/api/labels/1", ""},
	} {
		if w := requestAnon(h, tc.method, tc.path, tc.body); w.Code != 401 {
			t.Fatalf("%s %s anon: expected 401, got %d", tc.method, tc.path, w.Code)
		}
	}

	// Non-admin member can create/list/patch/delete labels (workspace-wide, same as projects/board_columns).
	w := requestWithCookie(h, "POST", "/api/labels", `{"name":"  Bug   Fix ","color":"#EF4444"}`, "member-session")
	if w.Code != 201 {
		t.Fatalf("member create label: %d %s", w.Code, w.Body.String())
	}
	var created Label
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "Bug Fix" || created.Color != "#ef4444" {
		t.Fatalf("unexpected created label: %+v", created)
	}

	// Duplicate key -> 409.
	w = request(h, "POST", "/api/labels", `{"name":"ｂｕｇ\u3000ＦＩＸ","color":"#3b82f6"}`)
	if w.Code != 409 {
		t.Fatalf("duplicate label: expected 409, got %d %s", w.Code, w.Body.String())
	}

	// Invalid inputs -> 400.
	badCreates := []string{
		`{"name":"","color":"#ef4444"}`,
		`{"name":"x","color":"#fff"}`,
		`{"name":"x","color":"#ef4444","extra":1}`,
		`{"name":"bad\u200B","color":"#ef4444"}`,
		fmt.Sprintf(`{"name":%q,"color":"#ef4444"}`, strings.Repeat("a", MaxLabelNameRunes+1)),
	}
	for _, b := range badCreates {
		if w := request(h, "POST", "/api/labels", b); w.Code != 400 {
			t.Fatalf("expected 400 for %s, got %d %s", b, w.Code, w.Body.String())
		}
	}

	// Second label for duplicate-on-PATCH 409 check, then delete it before workspace limit loop.
	wOther := request(h, "POST", "/api/labels", `{"name":"Other","color":"#22c55e"}`)
	if wOther.Code != 201 {
		t.Fatalf("create second label: %d %s", wOther.Code, wOther.Body.String())
	}
	var otherLabel Label
	if err := json.Unmarshal(wOther.Body.Bytes(), &otherLabel); err != nil {
		t.Fatal(err)
	}

	// PATCH validation, same-key 200, duplicate-key 409, unknown field 400, and 404.
	if w := request(h, "PATCH", "/api/labels/0", `{"name":"x"}`); w.Code != 400 {
		t.Fatalf("invalid path id: expected 400, got %d", w.Code)
	}
	if w := request(h, "PATCH", "/api/labels/9999", `{"name":"x"}`); w.Code != 404 {
		t.Fatalf("missing label: expected 404, got %d", w.Code)
	}
	if w := request(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{}`); w.Code != 400 {
		t.Fatalf("empty patch: expected 400, got %d", w.Code)
	}
	if w := request(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"name":null}`); w.Code != 400 {
		t.Fatalf("null name patch: expected 400, got %d", w.Code)
	}
	if w := request(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"extra":1}`); w.Code != 400 {
		t.Fatalf("unknown field patch: expected 400, got %d", w.Code)
	}
	if w := request(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"name":"ｏｔｈｅｒ"}`); w.Code != 409 {
		t.Fatalf("duplicate key patch: expected 409, got %d %s", w.Code, w.Body.String())
	}
	if w := requestWithCookie(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"name":"API","color":"#3B82F6"}`, "member-session"); w.Code != 200 {
		t.Fatalf("patch label: %d %s", w.Code, w.Body.String())
	}
	// Updating own name with same LabelNameKey ("API" -> "api") succeeds with 200, then restore "API".
	if w := requestWithCookie(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"name":"api"}`, "member-session"); w.Code != 200 {
		t.Fatalf("same-key patch label: expected 200, got %d %s", w.Code, w.Body.String())
	}
	if w := requestWithCookie(h, "PATCH", fmt.Sprintf("/api/labels/%d", created.ID), `{"name":"API"}`, "member-session"); w.Code != 200 {
		t.Fatalf("restore label name: %d %s", w.Code, w.Body.String())
	}
	if w := requestWithCookie(h, "DELETE", fmt.Sprintf("/api/labels/%d", otherLabel.ID), "", "member-session"); w.Code != 204 {
		t.Fatalf("cleanup second label: expected 204, got %d", w.Code)
	}

	// GET /api/labels -> id ASC.
	w = requestWithCookie(h, "GET", "/api/labels", "", "member-session")
	if w.Code != 200 {
		t.Fatalf("list labels: %d", w.Code)
	}
	var listRes struct {
		Labels []Label `json:"labels"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listRes); err != nil {
		t.Fatal(err)
	}
	if len(listRes.Labels) != 1 || listRes.Labels[0].Name != "API" || listRes.Labels[0].Color != "#3b82f6" {
		t.Fatalf("unexpected labels list: %+v", listRes.Labels)
	}

	// 200 workspace limit -> 409.
	for i := 1; i < MaxWorkspaceLabels; i++ {
		if _, err := repo.CreateLabel(context.Background(), LabelInput{Name: fmt.Sprintf("tag-%d", i), Color: "#64748b"}); err != nil {
			t.Fatal(err)
		}
	}
	if w := request(h, "POST", "/api/labels", `{"name":"overflow","color":"#64748b"}`); w.Code != 409 {
		t.Fatalf("200 limit: expected 409, got %d %s", w.Code, w.Body.String())
	}

	// DELETE 400, 204 & 404.
	if w := request(h, "DELETE", "/api/labels/0", ""); w.Code != 400 {
		t.Fatalf("delete invalid id: expected 400, got %d", w.Code)
	}
	if w := requestWithCookie(h, "DELETE", fmt.Sprintf("/api/labels/%d", created.ID), "", "member-session"); w.Code != 204 {
		t.Fatalf("delete label: expected 204, got %d", w.Code)
	}
	if w := request(h, "DELETE", fmt.Sprintf("/api/labels/%d", created.ID), ""); w.Code != 404 {
		t.Fatalf("delete missing: expected 404, got %d", w.Code)
	}
}

func TestItemLabelsCreateUpdateReflectACLAndHistory(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	member, err := repo.CreateUser(context.Background(), UserCreateInput{
		LoginName: "edit-member", DisplayName: "Member", Password: "member-pass-123", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.sessions["member-session"] = Session{ID: "member-session", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}

	var labels []Label
	for i := 0; i < 21; i++ {
		l, err := repo.CreateLabel(context.Background(), LabelInput{Name: fmt.Sprintf("L%02d", i+1), Color: "#3b82f6"})
		if err != nil {
			t.Fatal(err)
		}
		labels = append(labels, l)
	}
	h := NewHandler(repo)

	// Invalid labelIds -> 400.
	twentyOne := make([]string, 21)
	for i := range twentyOne {
		twentyOne[i] = fmt.Sprintf("%d", labels[i].ID)
	}
	for _, bad := range []string{
		fmt.Sprintf(`{"columnId":1,"title":"t","description":"d","labelIds":null}`),
		fmt.Sprintf(`{"columnId":1,"title":"t","description":"d","labelIds":[0]}`),
		fmt.Sprintf(`{"columnId":1,"title":"t","description":"d","labelIds":[%s]}`, strings.Join(twentyOne, ",")),
		fmt.Sprintf(`{"columnId":1,"title":"t","description":"d","labelIds":[999999]}`),
	} {
		if w := request(h, "POST", "/api/items", bad); w.Code != 400 {
			t.Fatalf("POST invalid labels %s: expected 400, got %d %s", bad, w.Code, w.Body.String())
		}
	}

	// Duplicate-only array > MaxItemLabelInputLen (65 repeats of same valid ID) -> 400 on POST.
	dup65 := strings.Repeat(fmt.Sprintf("%d,", labels[0].ID), MaxItemLabelInputLen) + fmt.Sprintf("%d", labels[0].ID)
	if w := request(h, "POST", "/api/items", fmt.Sprintf(`{"columnId":1,"title":"t","description":"d","labelIds":[%s]}`, dup65)); w.Code != 400 {
		t.Fatalf("POST >64 raw duplicate labelIds: expected 400, got %d %s", w.Code, w.Body.String())
	}

	// Create item with unsorted + duplicate labelIds -> returns sorted id ASC.
	w := request(h, "POST", "/api/items", fmt.Sprintf(`{"columnId":1,"title":"item 1","description":"d","labelIds":[%d,%d,%d]}`, labels[1].ID, labels[0].ID, labels[1].ID))
	if w.Code != 201 {
		t.Fatalf("create item with labels: %d %s", w.Code, w.Body.String())
	}
	var item Item
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if len(item.Labels) != 2 || item.Labels[0].ID != labels[0].ID || item.Labels[1].ID != labels[1].ID {
		t.Fatalf("unexpected item.Labels: %+v", item.Labels)
	}

	// Board and backlog include labels.
	w = request(h, "GET", "/api/board", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"L01"`) {
		t.Fatalf("board response missing label: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "GET", "/api/backlog", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"L01"`) {
		t.Fatalf("backlog response missing label: %d %s", w.Code, w.Body.String())
	}

	// Restricted view ACL -> member who cannot view item gets neither item nor its labels on board/backlog and 403 on PATCH.
	if _, err := repo.ReplaceItemACL(context.Background(), item.ID, ViewAccessRestricted, EditAccessRestricted, []int64{1}, []int64{1}); err != nil {
		t.Fatal(err)
	}
	if w := requestWithCookie(h, "PATCH", fmt.Sprintf("/api/items/%d", item.ID), fmt.Sprintf(`{"labelIds":[%d]}`, labels[2].ID), "member-session"); w.Code != 403 {
		t.Fatalf("member PATCH labels without view/edit: expected 403, got %d", w.Code)
	}
	for _, path := range []string{"/api/board", "/api/backlog"} {
		wm := requestWithCookie(h, "GET", path, "", "member-session")
		if wm.Code != 200 || strings.Contains(wm.Body.String(), `"item 1"`) || strings.Contains(wm.Body.String(), `"L01"`) {
			t.Fatalf("restricted item leaked on %s: %d %s", path, wm.Code, wm.Body.String())
		}
	}

	// Restricted edit ACL -> member who can view but not edit gets 403 on label patch.
	if _, err := repo.ReplaceItemACL(context.Background(), item.ID, ViewAccessOpen, EditAccessRestricted, nil, []int64{1}); err != nil {
		t.Fatal(err)
	}
	if w := requestWithCookie(h, "PATCH", fmt.Sprintf("/api/items/%d", item.ID), fmt.Sprintf(`{"labelIds":[%d]}`, labels[2].ID), "member-session"); w.Code != 403 {
		t.Fatalf("member PATCH labels without edit: expected 403, got %d", w.Code)
	}
	// Open edit again and test PATCH validation, PATCH update, and rename/recolor/delete reflection.
	if _, err := repo.ReplaceItemACL(context.Background(), item.ID, ViewAccessOpen, EditAccessOpen, nil, nil); err != nil {
		t.Fatal(err)
	}
	for _, badPatch := range []string{
		`{"labelIds":null}`,
		`{"labelIds":[0]}`,
		`{"labelIds":[1.5]}`,
		`{"labelIds":["1"]}`,
		fmt.Sprintf(`{"labelIds":[%s]}`, strings.Join(twentyOne, ",")),
		`{"labelIds":[999999]}`,
	} {
		if wp := request(h, "PATCH", fmt.Sprintf("/api/items/%d", item.ID), badPatch); wp.Code != 400 {
			t.Fatalf("PATCH invalid %s: expected 400, got %d %s", badPatch, wp.Code, wp.Body.String())
		}
	}
	w = request(h, "PATCH", fmt.Sprintf("/api/items/%d", item.ID), fmt.Sprintf(`{"labelIds":[%d,%d]}`, labels[2].ID, labels[0].ID))
	if w.Code != 200 {
		t.Fatalf("PATCH labels: %d %s", w.Code, w.Body.String())
	}
	var updated Item
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated.Labels) != 2 || updated.Labels[0].ID != labels[0].ID || updated.Labels[1].ID != labels[2].ID {
		t.Fatalf("unexpected updated labels: %+v", updated.Labels)
	}

	// Rename & recolor label -> detail reflects immediately.
	if w := request(h, "PATCH", fmt.Sprintf("/api/labels/%d", labels[0].ID), `{"name":"Renamed","color":"#10b981"}`); w.Code != 200 {
		t.Fatalf("rename label: %d", w.Code)
	}
	w = request(h, "GET", fmt.Sprintf("/api/items/by-number/%d?projectId=1", item.Number), "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"Renamed"`) || !strings.Contains(w.Body.String(), `"#10b981"`) {
		t.Fatalf("item detail did not reflect rename/recolor: %d %s", w.Code, w.Body.String())
	}

	// Delete one attached label -> disappears immediately from board, backlog, and item detail.
	if w := request(h, "DELETE", fmt.Sprintf("/api/labels/%d", labels[2].ID), ""); w.Code != 204 {
		t.Fatalf("delete attached label: expected 204, got %d", w.Code)
	}
	for _, path := range []string{"/api/board", "/api/backlog", fmt.Sprintf("/api/items/by-number/%d?projectId=1", item.Number)} {
		wd := request(h, "GET", path, "")
		if wd.Code != 200 || strings.Contains(wd.Body.String(), `"L03"`) || !strings.Contains(wd.Body.String(), `"Renamed"`) {
			t.Fatalf("delete reflection failed on %s: %d %s", path, wd.Code, wd.Body.String())
		}
	}

	// Archive item -> GET /api/archive shows labels, PATCH returns 409 Conflict.
	if _, err := repo.UpdateItem(context.Background(), item.ID, ItemPatch{ColumnID: ptrInt64(3)}); err != nil {
		t.Fatal(err)
	}
	c := repo.cards[item.ID]
	archivedAt := time.Now().UTC()
	c.ArchivedAt = &archivedAt
	repo.cards[item.ID] = c
	if w := request(h, "GET", "/api/archive", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"Renamed"`) {
		t.Fatalf("archive response missing label: %d %s", w.Code, w.Body.String())
	}
	if w := request(h, "PATCH", fmt.Sprintf("/api/items/%d", item.ID), `{"labelIds":[]}`); w.Code != 409 {
		t.Fatalf("archived item label patch: expected 409, got %d %s", w.Code, w.Body.String())
	}
}

func ptrInt64(v int64) *int64 { return &v }

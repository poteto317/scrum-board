package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRunRecurringAnonymousOK(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.ensureRecurring()
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: 1, Name: "weekly", Title: "lib update", Description: "deps",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	repo.nextRecurringID = 2
	h := NewHandler(repo)
	w := requestScheduler(h, "POST", "/api/recurring/run", "{}")
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var body struct {
		Created int `json:"created"`
		Skipped int `json:"skipped"`
		Failed  int `json:"failed"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Created != 1 || body.Skipped != 0 || body.Failed != 0 {
		t.Fatalf("counters=%+v", body)
	}
	var found *Item
	for _, c := range repo.cards {
		if c.Title == "lib update" {
			cc := c
			found = &cc
			break
		}
	}
	if found == nil {
		t.Fatal("item not created")
	}
	if found.ProjectID != 1 || found.Description != "deps" || found.ColumnID != 1 {
		t.Fatalf("item=%+v", found)
	}
	if found.CreatedByUserID != nil {
		t.Fatalf("createdBy=%v", found.CreatedByUserID)
	}
	if found.DueAt != nil {
		t.Fatalf("dueAt=%v", found.DueAt)
	}
}

func TestRunRecurringFailedAndSkippedCounters(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.ensureRecurring()
	other, err := repo.CreateProject(t.Context(), "other")
	if err != nil {
		t.Fatal(err)
	}
	// Due + valid → created
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: 1, Name: "ok", Title: "ok-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	// Not yet due → skipped
	repo.recurringRules[2] = RecurringRule{
		ID: 2, ProjectID: 1, Name: "later", Title: "later-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now, UpdatedAt: now,
	}
	// Missing column → failed; enabled stays true
	repo.recurringRules[3] = RecurringRule{
		ID: 3, ProjectID: 1, Name: "bad-col", Title: "bad-col-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 999, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	// Invalid cron at runtime → failed
	repo.recurringRules[4] = RecurringRule{
		ID: 4, ProjectID: other.ID, Name: "bad-cron", Title: "bad-cron-title", Description: "",
		Cron: "not-cron", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	// Disabled not counted
	repo.recurringRules[5] = RecurringRule{
		ID: 5, ProjectID: 1, Name: "off", Title: "off-title", Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: false,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	repo.nextRecurringID = 6

	created, skipped, failed, err := repo.RunRecurring(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if created != 1 || skipped != 1 || failed != 2 {
		t.Fatalf("created=%d skipped=%d failed=%d", created, skipped, failed)
	}
	if !repo.recurringRules[3].Enabled || !repo.recurringRules[4].Enabled {
		t.Fatal("failed rules must stay enabled")
	}
	if repo.recurringRules[3].LastFiredAt != nil || repo.recurringRules[4].LastFiredAt != nil {
		t.Fatal("failed rules must not advance lastFiredAt")
	}
	if repo.recurringRules[1].LastFiredAt == nil {
		t.Fatal("created rule should set lastFiredAt")
	}
}

func TestRunRecurringExpandsPlaceholders(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.ensureRecurring()
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: 1, Name: "dyn", Title: "週次 {{weekStart}}", Description: "日 {{date}}",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	repo.nextRecurringID = 2
	created, _, failed, err := repo.RunRecurring(t.Context())
	if err != nil || created != 1 || failed != 0 {
		t.Fatalf("created=%d failed=%d err=%v", created, failed, err)
	}
	wantTitle, wantDesc, wantErr := materializeRecurringFire(repo.recurringRules[1], now)
	if wantErr != nil {
		t.Fatalf("want materialize: %v", wantErr)
	}
	var found *Item
	for _, c := range repo.cards {
		if strings.Contains(c.Title, "週次") {
			cc := c
			found = &cc
			break
		}
	}
	if found == nil {
		t.Fatal("item missing")
	}
	if found.Title != wantTitle || found.Description != wantDesc {
		t.Fatalf("got title=%q desc=%q want title=%q desc=%q", found.Title, found.Description, wantTitle, wantDesc)
	}
	if strings.Contains(found.Title, "{{") || strings.Contains(found.Description, "{{weekStart}}") {
		t.Fatalf("placeholders left: %#v", found)
	}
}

func TestRunRecurringExpandOverlongFails(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.ensureRecurring()
	// 195 + {{date}}(10) = 205 > 200
	tpl := strings.Repeat("あ", 195) + "{{date}}"
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: 1, Name: "long", Title: tpl, Description: "",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	repo.nextRecurringID = 2
	created, _, failed, err := repo.RunRecurring(t.Context())
	if err != nil || created != 0 || failed != 1 {
		t.Fatalf("created=%d failed=%d err=%v", created, failed, err)
	}
	if len(repo.cards) != 0 {
		t.Fatalf("want no items, got %d", len(repo.cards))
	}
	if repo.recurringRules[1].LastFiredAt != nil {
		t.Fatal("failed expand must not set lastFiredAt")
	}
}

func TestRunRecurringUsesRuleProjectID(t *testing.T) {
	repo := fresh()
	other, err := repo.CreateProject(t.Context(), "other-pj")
	if err != nil {
		t.Fatal(err)
	}
	// Active stays 1; rule belongs to other.
	now := time.Now().UTC()
	repo.ensureRecurring()
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: other.ID, Name: "pj", Title: "other-card", Description: "d",
		Cron: "0 0 * * *", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	}
	repo.nextRecurringID = 2
	created, _, failed, err := repo.RunRecurring(t.Context())
	if err != nil || created != 1 || failed != 0 {
		t.Fatalf("created=%d failed=%d err=%v", created, failed, err)
	}
	var found *Item
	for _, c := range repo.cards {
		if c.Title == "other-card" {
			cc := c
			found = &cc
			break
		}
	}
	if found == nil || found.ProjectID != other.ID {
		t.Fatalf("want project %d, got %+v", other.ID, found)
	}
}

func TestRunRecurringOneTickOneFire(t *testing.T) {
	repo := fresh()
	now := time.Now().UTC()
	repo.ensureRecurring()
	// Weekly; created three weeks ago → one create, then second run skips.
	repo.recurringRules[1] = RecurringRule{
		ID: 1, ProjectID: 1, Name: "weekly", Title: "weekly-card", Description: "",
		Cron: "0 9 * * 1", Timezone: "UTC", ColumnID: 1, Enabled: true,
		CreatedAt: now.Add(-21 * 24 * time.Hour), UpdatedAt: now.Add(-21 * 24 * time.Hour),
	}
	repo.nextRecurringID = 2
	c1, _, f1, err := repo.RunRecurring(t.Context())
	if err != nil || c1 != 1 || f1 != 0 {
		t.Fatalf("first: created=%d failed=%d err=%v", c1, f1, err)
	}
	c2, s2, f2, err := repo.RunRecurring(t.Context())
	if err != nil || c2 != 0 || s2 != 1 || f2 != 0 {
		t.Fatalf("second: created=%d skipped=%d failed=%d err=%v", c2, s2, f2, err)
	}
	n := 0
	for _, card := range repo.cards {
		if card.Title == "weekly-card" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("items=%d want 1", n)
	}
}

func TestRecurringRulesCRUD(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	for _, body := range []string{
		`{"title":"t","cron":"0 9 * * 1","columnId":1}`,
		`{"name":"","title":"t","cron":"0 9 * * 1","columnId":1}`,
		`{"name":"n","title":"","cron":"0 9 * * 1","columnId":1}`,
		`{"name":"n","title":"t","cron":"not-a-cron","columnId":1}`,
		`{"name":"n","title":"t","cron":"0 9 * * 1 *","columnId":1}`,
		`{"name":"n","title":"t","cron":"0 9 * * 1","timezone":"","columnId":1}`,
		`{"name":"n","title":"t","cron":"0 9 * * 1","timezone":"Not/AZone","columnId":1}`,
		`{"name":"n","title":"t","cron":"0 9 * * 1","columnId":999}`,
		`{"name":"n","title":"t","cron":"0 9 * * 1","columnId":0}`,
	} {
		if w := request(h, "POST", "/api/recurring-rules", body); w.Code != 400 {
			t.Fatalf("want 400 for %s, got %d %s", body, w.Code, w.Body)
		}
	}

	other, err := repo.CreateProject(t.Context(), "other-pj")
	if err != nil {
		t.Fatal(err)
	}
	if w := request(h, "POST", "/api/recurring-rules",
		`{"name":"n","title":"t","cron":"0 9 * * 1","columnId":1,"projectId":`+itoa(other.ID)+`}`); w.Code != 400 {
		t.Fatalf("mismatched projectId want 400, got %d %s", w.Code, w.Body)
	}

	w := request(h, "POST", "/api/recurring-rules",
		`{"name":" weekly ","title":" lib ","description":"d","cron":"0 9 * * 1","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create omit tz: %d %s", w.Code, w.Body)
	}
	var created RecurringRule
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Timezone != "Asia/Tokyo" || !created.Enabled || created.ProjectID != 1 {
		t.Fatalf("defaults=%+v", created)
	}
	if created.Name != "weekly" || created.Title != "lib" || created.Description != "d" {
		t.Fatalf("normalized=%+v", created)
	}

	w = request(h, "POST", "/api/recurring-rules",
		`{"name":"a","title":"a-title","cron":"0 9 * * 1","timezone":"UTC","columnId":1,"enabled":false,"projectId":1}`)
	if w.Code != 201 {
		t.Fatalf("create with projectId match: %d %s", w.Code, w.Body)
	}
	var second RecurringRule
	if err := json.Unmarshal(w.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.Timezone != "UTC" || second.Enabled {
		t.Fatalf("second=%+v", second)
	}

	// Seed other-project rule (should not appear in GET).
	if _, err := repo.CreateRecurringRule(t.Context(), other.ID, RecurringRuleInput{
		Name: "other", Title: "other-t", Cron: "0 9 * * 1", Timezone: "UTC", ColumnID: 1,
	}); err != nil {
		t.Fatal(err)
	}

	w = request(h, "GET", "/api/recurring-rules", "")
	if w.Code != 200 {
		t.Fatalf("list=%d %s", w.Code, w.Body)
	}
	var list struct {
		Rules []RecurringRule `json:"rules"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Rules) != 2 {
		t.Fatalf("list len=%d want 2 body=%s", len(list.Rules), w.Body)
	}
	if list.Rules[0].ID > list.Rules[1].ID {
		t.Fatalf("not id ascending: %+v", list.Rules)
	}
	for _, rule := range list.Rules {
		if rule.ProjectID != 1 {
			t.Fatalf("leaked other project rule: %+v", rule)
		}
	}

	id := strconv.FormatInt(created.ID, 10)
	w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"enabled":false}`)
	if w.Code != 200 {
		t.Fatalf("disable=%d %s", w.Code, w.Body)
	}
	var patched RecurringRule
	if err := json.Unmarshal(w.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Enabled || patched.Name != "weekly" || patched.Description != "d" {
		t.Fatalf("omit fields must stay: %+v", patched)
	}

	w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"description":""}`)
	if w.Code != 200 {
		t.Fatalf("empty desc=%d %s", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &patched); err != nil {
		t.Fatal(err)
	}
	if patched.Description != "" || patched.Name != "weekly" {
		t.Fatalf("empty desc patch=%+v", patched)
	}

	if w = request(h, "PATCH", "/api/recurring-rules/"+id, `{}`); w.Code != 400 {
		t.Fatalf("empty patch want 400, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"description":null}`); w.Code != 400 {
		t.Fatalf("null desc want 400, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"timezone":""}`); w.Code != 400 {
		t.Fatalf("empty tz want 400, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"cron":"bad"}`); w.Code != 400 {
		t.Fatalf("bad cron want 400, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "PATCH", "/api/recurring-rules/"+id, `{"columnId":999}`); w.Code != 400 {
		t.Fatalf("bad column want 400, got %d %s", w.Code, w.Body)
	}

	// Other-project id → 404 (exists but not active project).
	otherRule, err := repo.CreateRecurringRule(t.Context(), other.ID, RecurringRuleInput{
		Name: "x", Title: "x", Cron: "0 9 * * 1", Timezone: "UTC", ColumnID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	otherID := strconv.FormatInt(otherRule.ID, 10)
	if w = request(h, "PATCH", "/api/recurring-rules/"+otherID, `{"name":"nope"}`); w.Code != 404 {
		t.Fatalf("other pj patch want 404, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "DELETE", "/api/recurring-rules/"+otherID, ""); w.Code != 404 {
		t.Fatalf("other pj delete want 404, got %d %s", w.Code, w.Body)
	}
	if w = request(h, "DELETE", "/api/recurring-rules/99999", ""); w.Code != 404 {
		t.Fatalf("missing delete want 404, got %d %s", w.Code, w.Body)
	}

	if w = request(h, "DELETE", "/api/recurring-rules/"+id, ""); w.Code != 204 {
		t.Fatalf("delete=%d %s", w.Code, w.Body)
	}
	w = request(h, "GET", "/api/recurring-rules", "")
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	for _, rule := range list.Rules {
		if rule.ID == created.ID {
			t.Fatalf("deleted rule still listed: %+v", list.Rules)
		}
	}
}

func TestRecurringRulesRequireAuth(t *testing.T) {
	h := NewHandler(fresh())
	for _, tc := range []struct {
		method, path, body string
	}{
		{"GET", "/api/recurring-rules", ""},
		{"POST", "/api/recurring-rules", `{"name":"n","title":"t","cron":"0 9 * * 1","columnId":1}`},
		{"PATCH", "/api/recurring-rules/1", `{"enabled":false}`},
		{"DELETE", "/api/recurring-rules/1", ""},
	} {
		w := requestAnon(h, tc.method, tc.path, tc.body)
		if w.Code != 401 {
			t.Fatalf("%s %s want 401, got %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
	if w := requestScheduler(h, "POST", "/api/recurring/run", "{}"); w.Code != 200 {
		t.Fatalf("run must stay exempt: %d %s", w.Code, w.Body)
	}
}

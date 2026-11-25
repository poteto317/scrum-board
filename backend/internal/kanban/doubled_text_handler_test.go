package kanban

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRepairDoubledTextAuth(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := requestAnon(h, "POST", "/api/admin/repair-doubled-text", `{}`)
	if w.Code != 401 {
		t.Fatalf("anon: %d %s", w.Code, w.Body)
	}

	hash, err := HashPassword("member-pass")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	repo.users = append(repo.users, User{
		ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash,
		Role: RoleMember, CreatedAt: now, UpdatedAt: now,
	})
	sess, err := repo.CreateSession(t.Context(), 2, now)
	if err != nil {
		t.Fatal(err)
	}
	w = requestWithCookie(h, "POST", "/api/admin/repair-doubled-text", `{}`, sess.ID)
	assertAPIMessage(t, w.Code, w.Body.Bytes(), 403, msgForbidden)
}

func TestRepairDoubledTextEmptyOK(t *testing.T) {
	repo := fresh()
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	repo.cards[1] = Item{
		ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "ok",
		Description: "plain", Solution: "plain", CreatedAt: created,
	}
	h := NewHandler(repo)
	w := request(h, "POST", "/api/admin/repair-doubled-text", `{}`)
	if w.Code != 200 {
		t.Fatalf("code %d %s", w.Code, w.Body)
	}
	var resp doubledRepairResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Scanned != 1 || resp.DescriptionRepaired != 0 || resp.SolutionRepaired != 0 {
		t.Fatalf("counts: %+v", resp)
	}
	if len(resp.Repairs) != 0 || len(resp.ItemIDs) != 0 {
		t.Fatalf("expected empty repairs: %+v", resp)
	}
}

func TestRepairDoubledTextDryRunAndApply(t *testing.T) {
	repo := fresh()
	created := time.Date(2024, 5, 6, 7, 8, 9, 0, time.UTC)
	repo.cards[10] = Item{
		ID: 10, Number: 10, ColumnID: 1, ProjectID: 1, Title: "desc only",
		Description: "あいうあいう", Solution: "solo", CreatedAt: created,
	}
	repo.cards[11] = Item{
		ID: 11, Number: 11, ColumnID: 1, ProjectID: 1, Title: "sol only",
		Description: "x", Solution: "ひらがなひらがな", CreatedAt: created,
	}
	repo.cards[12] = Item{
		ID: 12, Number: 12, ColumnID: 1, ProjectID: 1, Title: "both",
		Description: "ABAB", Solution: "CDCD", CreatedAt: created,
	}
	h := NewHandler(repo)

	w := request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":true}`)
	if w.Code != 200 {
		t.Fatalf("dry-run %d %s", w.Code, w.Body)
	}
	var dry doubledRepairResponse
	if err := json.Unmarshal(w.Body.Bytes(), &dry); err != nil {
		t.Fatal(err)
	}
	if !dry.DryRun || dry.DescriptionRepaired != 2 || dry.SolutionRepaired != 2 {
		t.Fatalf("dry counts: %+v", dry)
	}
	if repo.cards[10].Description != "あいうあいう" || repo.cards[12].Solution != "CDCD" {
		t.Fatal("dry-run mutated cards")
	}

	w = request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":false}`)
	if w.Code != 200 {
		t.Fatalf("apply %d %s", w.Code, w.Body)
	}
	var applied doubledRepairResponse
	if err := json.Unmarshal(w.Body.Bytes(), &applied); err != nil {
		t.Fatal(err)
	}
	if applied.DryRun || applied.DescriptionRepaired != 2 || applied.SolutionRepaired != 2 {
		t.Fatalf("apply counts: %+v", applied)
	}
	if repo.cards[10].Description != "あいう" || repo.cards[10].Solution != "solo" {
		t.Fatalf("card10: %+v", repo.cards[10])
	}
	if repo.cards[11].Description != "x" || repo.cards[11].Solution != "ひらがな" {
		t.Fatalf("card11: %+v", repo.cards[11])
	}
	if repo.cards[12].Description != "AB" || repo.cards[12].Solution != "CD" {
		t.Fatalf("card12: %+v", repo.cards[12])
	}
	if !repo.cards[10].CreatedAt.Equal(created) || repo.cards[10].ID != 10 {
		t.Fatalf("id/createdAt changed: %+v", repo.cards[10])
	}
}

func TestRepairDoubledTextFoldLimitWarning(t *testing.T) {
	repo := fresh()
	long := strings.Repeat("a", 512)
	want, _, _ := collapseExactDoubledText(long, doubledTextFoldLimit)
	repo.cards[1] = Item{
		ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "long",
		Description: long, Solution: "",
	}
	h := NewHandler(repo)
	w := request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":true}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var resp doubledRepairResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Warnings) != 1 || !strings.Contains(resp.Warnings[0], "fold limit reached") {
		t.Fatalf("warnings: %+v", resp.Warnings)
	}
	if resp.DescriptionRepaired != 1 {
		t.Fatalf("expected repair planned: %+v", resp)
	}

	w = request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":false}`)
	if w.Code != 200 {
		t.Fatalf("apply %d %s", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Warnings) != 1 || repo.cards[1].Description != want {
		t.Fatalf("apply fold: warnings=%v descLen=%d wantLen=%d", resp.Warnings, len(repo.cards[1].Description), len(want))
	}
}

func TestRepairDoubledTextDryRunNullRejected(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":null}`)
	if w.Code != 400 {
		t.Fatalf("want 400, got %d %s", w.Code, w.Body)
	}
}

func TestRepairDoubledTextListFail(t *testing.T) {
	repo := fresh()
	repo.listLivingFail = errors.New("list boom")
	h := NewHandler(repo)
	w := request(h, "POST", "/api/admin/repair-doubled-text", `{}`)
	if w.Code < 500 {
		t.Fatalf("want 5xx, got %d %s", w.Code, w.Body)
	}
}

func TestRepairDoubledTextUpdateFailContinues(t *testing.T) {
	repo := fresh()
	repo.cards[1] = Item{
		ID: 1, Number: 1, ColumnID: 1, ProjectID: 1, Title: "a",
		Description: "abab", Solution: "",
	}
	repo.cards[2] = Item{
		ID: 2, Number: 2, ColumnID: 1, ProjectID: 1, Title: "b",
		Description: "cdcd", Solution: "",
	}
	repo.updateItemFail = errors.New("update boom")
	repo.updateItemFailID = 1
	h := NewHandler(repo)
	w := request(h, "POST", "/api/admin/repair-doubled-text", `{"dryRun":false}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var resp doubledRepairResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.FailedItemIDs) != 1 || resp.FailedItemIDs[0] != 1 {
		t.Fatalf("failed: %+v", resp.FailedItemIDs)
	}
	if resp.DescriptionRepaired != 1 || len(resp.Repairs) != 1 || resp.Repairs[0].ItemID != 2 {
		t.Fatalf("counts must exclude failed: %+v", resp)
	}
	if repo.cards[2].Description != "cd" {
		t.Fatalf("card2 should repair: %q", repo.cards[2].Description)
	}
	if repo.cards[1].Description != "abab" {
		t.Fatalf("card1 should stay: %q", repo.cards[1].Description)
	}
}

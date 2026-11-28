package kanban

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func TestLabelsAndItemLabelsDDLMatchSchemaSQL(t *testing.T) {
	schema, err := os.ReadFile("../../../database/init/001_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	normSQL := squashSQL(string(schema))
	if !strings.Contains(normSQL, squashSQL(labelsDDL)) {
		t.Fatal("database/init/001_schema.sql must contain the same labels DDL as labelsDDL")
	}
	if !strings.Contains(normSQL, squashSQL(itemLabelsDDL)) {
		t.Fatal("database/init/001_schema.sql must contain the same item_labels DDL as itemLabelsDDL")
	}
}

func TestNormalizeLabelNameAndKey(t *testing.T) {
	if got, ok := NormalizeLabelName("  bug   fix  "); !ok || got != "bug fix" {
		t.Fatalf("got %q ok=%v", got, ok)
	}
	if got, ok := NormalizeLabelName("bug\u0085fix"); !ok || got != "bug fix" {
		t.Fatalf("NEL space normalization: got %q ok=%v", got, ok)
	}
	if _, ok := NormalizeLabelName("   \t\n "); ok {
		t.Fatal("blank name must fail")
	}
	if _, ok := NormalizeLabelName("bad\x00name"); ok {
		t.Fatal("control char must fail")
	}
	if _, ok := NormalizeLabelName("bad\u200Bname"); ok {
		t.Fatal("Cf invisible char must fail")
	}
	if _, ok := NormalizeLabelName("bad\uFE0Fname"); ok {
		t.Fatal("variation selector must fail")
	}
	if _, ok := NormalizeLabelName(string([]byte{0xff, 0xfe})); ok {
		t.Fatal("invalid utf8 must fail")
	}

	// 40-rune surrogate/emoji boundary: 40 non-BMP runes must pass, 41 must fail.
	forty := strings.Repeat("🚀", MaxLabelNameRunes)
	if got, ok := NormalizeLabelName(forty); !ok || utf8.RuneCountInString(got) != MaxLabelNameRunes {
		t.Fatalf("40 non-BMP runes must pass: ok=%v len=%d", ok, utf8.RuneCountInString(got))
	}
	fortyOne := strings.Repeat("🚀", MaxLabelNameRunes+1)
	if _, ok := NormalizeLabelName(fortyOne); ok {
		t.Fatal("41 non-BMP runes must fail")
	}

	// Normalization equivalence & idempotence.
	samples := []struct {
		a string
		b string
	}{
		{"Bug", "ｂｕｇ"},
		{"Cafe\u0301", "CAFÉ"},
		{"api\u3000v2", "API   V2"},
		{"Front  End", "front end"},
		{"İ", "i\u0307"},
		{"Σ", "σ"},
		{"Σ", "ς"},
		{"ß", "SS"},
		{"ｱｲｳ", "アイウ"},
	}
	for _, s := range samples {
		ka := LabelNameKey(s.a)
		kb := LabelNameKey(s.b)
		if ka == "" || ka != kb {
			t.Fatalf("LabelNameKey(%q)=%q != LabelNameKey(%q)=%q", s.a, ka, s.b, kb)
		}
		if LabelNameKey(ka) != ka {
			t.Fatalf("LabelNameKey not idempotent for %q", ka)
		}
	}
	if got := LabelNameKey("a\u2002b\u00a0c"); got != "a b c" {
		t.Fatalf("expected space collapse after NFKC: %q", got)
	}
	// Worst-case 40-rune NFKC expansion (U+FDFA -> 18 scalars per rune = 720 scalars) fits VARCHAR(720).
	worstKey := LabelNameKey(strings.Repeat("\uFDFA", MaxLabelNameRunes))
	if utf8.RuneCountInString(worstKey) > 720 {
		t.Fatalf("name_key overflowed VARCHAR(720): runes=%d", utf8.RuneCountInString(worstKey))
	}
}

func TestNormalizeLabelColor(t *testing.T) {
	if got, ok := NormalizeLabelColor("  #3B82F6 "); !ok || got != "#3b82f6" {
		t.Fatalf("got %q ok=%v", got, ok)
	}
	for _, bad := range []string{"", "#fff", "3b82f6", "#gggggg", "#1234567", "red"} {
		if _, ok := NormalizeLabelColor(bad); ok {
			t.Fatalf("expected invalid color for %q", bad)
		}
	}
}

func TestLabelsHistoryJSON(t *testing.T) {
	if got := labelsHistoryJSON(nil); got != "[]" {
		t.Fatalf("nil labels history: got %q", got)
	}
	if got := labelsHistoryJSON([]Label{{ID: 1, Name: "bug", Color: "#ef4444"}, {ID: 2, Name: "api", Color: "#3b82f6"}}); got != `["bug","api"]` {
		t.Fatalf("labels history: got %q", got)
	}
}

func TestLabelsMySQLRepository(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := context.Background()

	l1, err := repo.CreateLabel(ctx, LabelInput{Name: "Bug", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}
	l2, err := repo.CreateLabel(ctx, LabelInput{Name: "API", Color: "#3b82f6"})
	if err != nil {
		t.Fatal(err)
	}
	// Duplicate key via full-width + case fold -> ErrLabelDuplicate.
	if _, err := repo.CreateLabel(ctx, LabelInput{Name: "ｂｕｇ", Color: "#22c55e"}); !errors.Is(err, ErrLabelDuplicate) {
		t.Fatalf("expected ErrLabelDuplicate, got %v", err)
	}

	// Unknown label attach -> ErrUnknownLabel.
	if _, err := repo.CreateItem(ctx, ItemInput{
		ColumnID:    1,
		Title:       "bad label",
		Description: "d",
		LabelIDs:    []int64{999999},
	}); !errors.Is(err, ErrUnknownLabel) {
		t.Fatalf("expected ErrUnknownLabel, got %v", err)
	}

	// Attach labels out-of-order with duplicates -> stored sorted id ASC.
	card, err := repo.CreateItem(ctx, ItemInput{
		ColumnID:    1,
		Title:       "with labels",
		Description: "d",
		LabelIDs:    []int64{l2.ID, l1.ID, l2.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(card.Labels) != 2 || card.Labels[0].ID != l1.ID || card.Labels[1].ID != l2.ID {
		t.Fatalf("unexpected attached labels: %+v", card.Labels)
	}

	// Rename & recolor reflects on loaded card.
	newName := "Backend API"
	newColor := "#8b5cf6"
	if _, err := repo.UpdateLabel(ctx, l2.ID, LabelPatch{Name: &newName, Color: &newColor}); err != nil {
		t.Fatal(err)
	}
	loaded, err := repo.GetItem(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Labels[1].Name != "Backend API" || loaded.Labels[1].Color != "#8b5cf6" {
		t.Fatalf("rename/recolor not reflected: %+v", loaded.Labels)
	}

	// Delete label cascades item_labels row.
	if err := repo.DeleteLabel(ctx, l1.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err = repo.GetItem(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Labels) != 1 || loaded.Labels[0].ID != l2.ID {
		t.Fatalf("delete cascade failed: %+v", loaded.Labels)
	}

	// Missing label update/delete -> ErrNotFound.
	if _, err := repo.UpdateLabel(ctx, 999999, LabelPatch{Name: &newName}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	if err := repo.DeleteLabel(ctx, 999999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// History recorded initial and updated labels.
	if _, err := repo.UpdateItem(ctx, card.ID, ItemPatch{LabelIDs: &[]int64{l2.ID}}); err != nil {
		t.Fatal(err)
	}
	matches, err := repo.SearchProjectItems(ctx, 1, ItemSearch{
		LabelIDs: []int64{l2.ID},
		Viewer:   ItemSearchViewer{Admin: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0].ID != card.ID || len(matches[0].Labels) != 1 || matches[0].Labels[0].ID != l2.ID {
		t.Fatalf("SearchItems by label in MySQL mismatch: %+v", matches)
	}
	// Unknown label in UpdateItem returns ErrUnknownLabel and rolls back (existing labels preserved).
	if _, err := repo.UpdateItem(ctx, card.ID, ItemPatch{LabelIDs: &[]int64{999999}}); !errors.Is(err, ErrUnknownLabel) {
		t.Fatalf("UpdateItem unknown label: expected ErrUnknownLabel, got %v", err)
	}
	afterBadPatch, err := repo.GetItem(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(afterBadPatch.Labels) != 1 || afterBadPatch.Labels[0].ID != l2.ID {
		t.Fatalf("UpdateItem rollback did not preserve labels: %+v", afterBadPatch.Labels)
	}
	// HTTP GET /api/items/by-number/{number}/history includes labels changes from MySQL.
	adminUser, err := repo.CreateUser(ctx, UserCreateInput{
		LoginName: "mysql-hist-admin", DisplayName: "Admin", Password: "admin-pass-123", Role: RoleAdmin,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(ctx, adminUser.ID, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	mh := NewHandler(repo)
	hw := requestWithCookie(mh, "GET", fmt.Sprintf("/api/items/by-number/%d/history?projectId=%d", card.Number, card.ProjectID), "", sess.ID)
	if hw.Code != 200 || !strings.Contains(hw.Body.String(), `"labels"`) {
		t.Fatalf("MySQL HTTP history missing labels change: %d %s", hw.Code, hw.Body.String())
	}
	if _, err := repo.UpdateItem(ctx, card.ID, ItemPatch{LabelIDs: &[]int64{}}); err != nil {
		t.Fatal(err)
	}
	hist, err := repo.History(ctx, card.Number, card.ProjectID, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundHist := false
	for _, ev := range hist.Events {
		for _, ch := range ev.Changes {
			if ch.Field == "labels" {
				foundHist = true
			}
		}
	}
	if !foundHist {
		t.Fatalf("expected labels history entry in MySQL history, got %+v", hist.Events)
	}

	// 200-label workspace limit -> ErrLabelLimit.
	existing, err := repo.ListLabels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := len(existing); i < MaxWorkspaceLabels; i++ {
		if _, err := repo.CreateLabel(ctx, LabelInput{Name: fmt.Sprintf("L-%03d", i), Color: "#64748b"}); err != nil {
			t.Fatalf("fill label %d: %v", i, err)
		}
	}
	if _, err := repo.CreateLabel(ctx, LabelInput{Name: "over-limit", Color: "#64748b"}); !errors.Is(err, ErrLabelLimit) {
		t.Fatalf("expected ErrLabelLimit, got %v", err)
	}

	list, err := repo.ListLabels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != MaxWorkspaceLabels || !slices.IsSortedFunc(list, func(a, b Label) int { return int(a.ID - b.ID) }) {
		t.Fatalf("unexpected list len=%d", len(list))
	}
}

func TestLabelsMySQLConcurrentCreateAndUpdateDeleteNoDeadlock(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	ctx := context.Background()

	// Empty table concurrent CreateLabel must not hit InnoDB supremum gap-lock deadlock (1213).
	const workers = 10
	start := make(chan struct{})
	createErrs := make(chan error, workers)
	created := make(chan Label, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			l, err := repo.CreateLabel(ctx, LabelInput{Name: fmt.Sprintf("conc-%02d", i), Color: "#3b82f6"})
			createErrs <- err
			if err == nil {
				created <- l
			}
		}(i)
	}
	close(start)
	wg.Wait()
	close(createErrs)
	close(created)
	for err := range createErrs {
		if err != nil {
			t.Fatalf("concurrent CreateLabel failed: %v", err)
		}
	}
	var pool []Label
	for l := range created {
		pool = append(pool, l)
	}
	if len(pool) < 2 {
		t.Fatalf("expected at least 2 created labels, got %d", len(pool))
	}

	// Concurrent UpdateItem (keeping/updating labels) vs DeleteLabel must not deadlock.
	keep := pool[0]
	var items []Item
	for i := 1; i < len(pool); i++ {
		it, err := repo.CreateItem(ctx, ItemInput{
			ColumnID:    1,
			Title:       fmt.Sprintf("item-%d", i),
			Description: "d",
			LabelIDs:    []int64{keep.ID, pool[i].ID},
		})
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, it)
	}
	var raceWG sync.WaitGroup
	raceStart := make(chan struct{})
	raceErrs := make(chan error, len(items)*2)
	for idx, it := range items {
		delTarget := pool[idx+1]
		raceWG.Add(2)
		go func(itemID int64) {
			defer raceWG.Done()
			<-raceStart
			_, err := repo.UpdateItem(ctx, itemID, ItemPatch{LabelIDs: &[]int64{keep.ID}})
			raceErrs <- err
		}(it.ID)
		go func(labelID int64) {
			defer raceWG.Done()
			<-raceStart
			raceErrs <- repo.DeleteLabel(ctx, labelID)
		}(delTarget.ID)
	}
	close(raceStart)
	raceWG.Wait()
	close(raceErrs)
	for err := range raceErrs {
		if err != nil && !errors.Is(err, ErrUnknownLabel) {
			t.Fatalf("unexpected concurrent UpdateItem/DeleteLabel error: %v", err)
		}
	}
}

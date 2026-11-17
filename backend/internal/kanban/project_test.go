package kanban

import (
	"errors"
	"testing"
)

func TestResolveActiveProjectID(t *testing.T) {
	projects := []Project{
		{ID: 2, Name: "b", Position: 1},
		{ID: 4, Name: "later", Position: 0},
		{ID: 3, Name: "earlier", Position: 0},
	}
	if got := resolveActiveProjectID(2, projects); got != 2 {
		t.Fatalf("existing raw: %d", got)
	}
	if got := resolveActiveProjectID(99, projects); got != 3 {
		t.Fatalf("invalid falls back to position then id: %d", got)
	}
	if got := resolveActiveProjectID(0, projects); got != 3 {
		t.Fatalf("missing falls back: %d", got)
	}
	if got := resolveActiveProjectID(1, nil); got != 0 {
		t.Fatalf("empty: %d", got)
	}
}

func TestNormalizeProjectName(t *testing.T) {
	name, err := normalizeProjectName("  メイン  ")
	if err != nil || name != "メイン" {
		t.Fatalf("trim: %q %v", name, err)
	}
	if _, err = normalizeProjectName("   "); err == nil {
		t.Fatal("blank")
	}
	if _, err = normalizeProjectName(""); err == nil {
		t.Fatal("empty")
	}
	if _, err = normalizeProjectName(repeat('a', 81)); err == nil {
		t.Fatal("81")
	}
	name, err = normalizeProjectName(repeat('あ', 80))
	if err != nil || name != repeat('あ', 80) {
		t.Fatalf("80 runes: %v len=%d", err, len([]rune(name)))
	}
}

func TestApplyBoardSettingsPatchActiveProject(t *testing.T) {
	cols := []Column{{ID: 1, Name: "Todo", Position: 0}}
	projects := []Project{{ID: 1, Name: "メイン", Position: 0}, {ID: 2, Name: "次", Position: 1}}
	current := BoardSettings{CardLayout: CardLayoutPack, MobileBoardColumnID: 1, ActiveProjectID: 99}
	layout := CardLayoutFree
	next, err := applyBoardSettingsPatch(current, cols, projects, BoardSettingsPatch{CardLayout: &layout})
	if err != nil || next.ActiveProjectID != 99 || next.CardLayout != CardLayoutFree || next.MobileBoardColumnID != 1 {
		t.Fatalf("layout only keeps raw active: %+v %v", next, err)
	}
	id := int64(2)
	next, err = applyBoardSettingsPatch(current, cols, projects, BoardSettingsPatch{ActiveProjectID: &id})
	if err != nil || next.ActiveProjectID != 2 || next.CardLayout != CardLayoutPack || next.MobileBoardColumnID != 1 {
		t.Fatalf("active only: %+v %v", next, err)
	}
	missing := int64(50)
	if _, err = applyBoardSettingsPatch(current, cols, projects, BoardSettingsPatch{ActiveProjectID: &missing}); err == nil {
		t.Fatal("missing id")
	}
	zero := int64(0)
	if _, err = applyBoardSettingsPatch(current, cols, projects, BoardSettingsPatch{ActiveProjectID: &zero}); err == nil {
		t.Fatal("zero")
	}
	if _, err = applyBoardSettingsPatch(current, cols, projects, BoardSettingsPatch{}); err == nil {
		t.Fatal("empty")
	}
}

func repeat(r rune, n int) string {
	out := make([]rune, n)
	for i := range out {
		out[i] = r
	}
	return string(out)
}

func TestResolveCreateProjectID(t *testing.T) {
	projects := []Project{{ID: 1, Position: 0}, {ID: 2, Position: 1}}
	settings := BoardSettings{ActiveProjectID: 1}
	id, err := resolveCreateProjectID(ItemInput{}, settings, projects)
	if err != nil || id != 1 {
		t.Fatalf("omit: %d %v", id, err)
	}
	want := int64(2)
	id, err = resolveCreateProjectID(ItemInput{ProjectID: &want}, settings, projects)
	if err != nil || id != 2 {
		t.Fatalf("explicit: %d %v", id, err)
	}
	bad := int64(99)
	if _, err = resolveCreateProjectID(ItemInput{ProjectID: &bad}, settings, projects); !errors.Is(err, ErrProject) {
		t.Fatalf("bad id: %v", err)
	}
}

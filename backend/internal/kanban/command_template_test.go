package kanban

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeCommandTemplateName(t *testing.T) {
	ok, _ := NormalizeCommandTemplateName("  hello  ")
	if v, good := NormalizeCommandTemplateName("  hello  "); !good || v != "hello" {
		t.Fatalf("trim: %q %v", v, good)
	}
	_ = ok
	if _, good := NormalizeCommandTemplateName(""); good {
		t.Fatal("empty should fail")
	}
	if _, good := NormalizeCommandTemplateName("   "); good {
		t.Fatal("blank should fail")
	}
	if v, good := NormalizeCommandTemplateName(strings.Repeat("あ", 60)); !good || utf8.RuneCountInString(v) != 60 {
		t.Fatalf("60 runes: %q %v", v, good)
	}
	if _, good := NormalizeCommandTemplateName(strings.Repeat("あ", 61)); good {
		t.Fatal("61 runes should fail")
	}
	if _, good := NormalizeCommandTemplateName("a\nb"); good {
		t.Fatal("control should fail")
	}
	if _, good := NormalizeCommandTemplateName(string([]byte{0xff, 0xfe})); good {
		t.Fatal("invalid utf8 name should fail")
	}
}

func TestNormalizeCommandTemplateBody(t *testing.T) {
	if v, good := NormalizeCommandTemplateBody("  keep spaces  "); !good || v != "  keep spaces  " {
		t.Fatalf("no trim: %q %v", v, good)
	}
	if _, good := NormalizeCommandTemplateBody(""); good {
		t.Fatal("empty should fail")
	}
	if v, good := NormalizeCommandTemplateBody(strings.Repeat("x", 2000)); !good || v != strings.Repeat("x", 2000) {
		t.Fatalf("2000: len=%d %v", len(v), good)
	}
	if _, good := NormalizeCommandTemplateBody(strings.Repeat("x", 2001)); good {
		t.Fatal("2001 should fail")
	}
	if _, good := NormalizeCommandTemplateBody("line\nbreak"); good {
		t.Fatal("LF should fail")
	}
	if _, good := NormalizeCommandTemplateBody(string([]byte{0xff, 0xfe})); good {
		t.Fatal("invalid utf8 body should fail")
	}
}

func TestMemoryCommandTemplatesCRUDAndLimit(t *testing.T) {
	m := fresh()
	list, err := m.ListCommandTemplates(t.Context())
	if err != nil || len(list) != 0 {
		t.Fatalf("empty list: %v %+v", err, list)
	}
	created, err := m.CreateCommandTemplate(t.Context(), CommandTemplateInput{Name: "co'py", Template: "  open {{url}}  "})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Position != 0 || created.Name != "co'py" || created.Template != "  open {{url}}  " {
		t.Fatalf("created=%+v", created)
	}
	second, err := m.CreateCommandTemplate(t.Context(), CommandTemplateInput{Name: "next", Template: "echo"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Position != 1 || second.ID <= created.ID {
		t.Fatalf("second=%+v", second)
	}
	list, err = m.ListCommandTemplates(t.Context())
	if err != nil || len(list) != 2 || list[0].ID != created.ID || list[1].ID != second.ID {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	renamed := "renamed"
	updated, err := m.UpdateCommandTemplate(t.Context(), created.ID, CommandTemplatePatch{Name: &renamed})
	if err != nil || updated.Name != "renamed" || updated.Template != "  open {{url}}  " || updated.Position != 0 {
		t.Fatalf("name patch=%+v err=%v", updated, err)
	}
	body := "printf {{url}}"
	updated, err = m.UpdateCommandTemplate(t.Context(), second.ID, CommandTemplatePatch{Template: &body})
	if err != nil || updated.Name != "next" || updated.Template != body {
		t.Fatalf("template patch=%+v err=%v", updated, err)
	}
	if err = m.DeleteCommandTemplate(t.Context(), created.ID); err != nil {
		t.Fatal(err)
	}
	third, err := m.CreateCommandTemplate(t.Context(), CommandTemplateInput{Name: "third", Template: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if third.Position != second.Position+1 {
		t.Fatalf("position after deleting smaller: got %d want remaining max+1 %d", third.Position, second.Position+1)
	}
	if err = m.DeleteCommandTemplate(t.Context(), created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	if _, err = m.UpdateCommandTemplate(t.Context(), created.ID, CommandTemplatePatch{Name: &renamed}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing update: %v", err)
	}
	if err = m.DeleteCommandTemplate(t.Context(), second.ID); err != nil {
		t.Fatal(err)
	}
	if err = m.DeleteCommandTemplate(t.Context(), third.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxCommandTemplates; i++ {
		row, err := m.CreateCommandTemplate(t.Context(), CommandTemplateInput{Name: "n", Template: "t"})
		if err != nil || row.Position != i {
			t.Fatalf("create %d: %+v %v", i, row, err)
		}
	}
	if _, err = m.CreateCommandTemplate(t.Context(), CommandTemplateInput{Name: "overflow", Template: "t"}); !errors.Is(err, ErrCommandTemplateLimit) {
		t.Fatalf("limit: %v", err)
	}
	list, err = m.ListCommandTemplates(t.Context())
	if err != nil || len(list) != MaxCommandTemplates {
		t.Fatalf("len=%d err=%v", len(list), err)
	}
}

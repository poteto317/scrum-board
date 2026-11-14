package kanban

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestMySQLCommandTemplatesCRUDAndLimit(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, "DROP TABLE IF EXISTS command_templates"); err != nil {
		t.Fatal(err)
	}
	r := MySQLRepository{DB: db}
	if err := r.InitializeCommandTemplates(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeCommandTemplates(ctx); err != nil {
		t.Fatal(err)
	}

	created, err := r.CreateCommandTemplate(ctx, CommandTemplateInput{Name: "co'py", Template: "  open {{url}}  "})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Position != 0 || created.Name != "co'py" || created.Template != "  open {{url}}  " {
		t.Fatalf("created=%+v", created)
	}
	second, err := r.CreateCommandTemplate(ctx, CommandTemplateInput{Name: strings.Repeat("あ", 60), Template: "echo"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Position != 1 || second.ID <= created.ID {
		t.Fatalf("second=%+v first=%+v", second, created)
	}

	list, err := r.ListCommandTemplates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != created.ID || list[1].ID != second.ID {
		t.Fatalf("list=%+v", list)
	}

	renamed := "renamed"
	updated, err := r.UpdateCommandTemplate(ctx, created.ID, CommandTemplatePatch{Name: &renamed})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "renamed" || updated.Template != "  open {{url}}  " || updated.Position != 0 {
		t.Fatalf("name patch=%+v", updated)
	}
	body := "printf {{url}}"
	updated, err = r.UpdateCommandTemplate(ctx, second.ID, CommandTemplatePatch{Template: &body})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != strings.Repeat("あ", 60) || updated.Template != body || updated.Position != 1 {
		t.Fatalf("template patch=%+v", updated)
	}

	if err = r.DeleteCommandTemplate(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	third, err := r.CreateCommandTemplate(ctx, CommandTemplateInput{Name: "third", Template: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if third.Position != second.Position+1 {
		t.Fatalf("position after deleting smaller: got %d want remaining max+1 %d", third.Position, second.Position+1)
	}
	if err = r.DeleteCommandTemplate(ctx, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	if _, err = r.UpdateCommandTemplate(ctx, created.ID, CommandTemplatePatch{Name: &renamed}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing update: %v", err)
	}

	if err = r.DeleteCommandTemplate(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteCommandTemplate(ctx, third.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxCommandTemplates; i++ {
		row, err := r.CreateCommandTemplate(ctx, CommandTemplateInput{Name: fmt.Sprintf("n%d", i), Template: "t"})
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		if row.Position != i {
			t.Fatalf("position %d: %+v", i, row)
		}
	}
	if _, err = r.CreateCommandTemplate(ctx, CommandTemplateInput{Name: "overflow", Template: "t"}); !errors.Is(err, ErrCommandTemplateLimit) {
		t.Fatalf("limit: %v", err)
	}
	list, err = r.ListCommandTemplates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != MaxCommandTemplates {
		t.Fatalf("len=%d", len(list))
	}
	for i := 1; i < len(list); i++ {
		if list[i].Position < list[i-1].Position || (list[i].Position == list[i-1].Position && list[i].ID < list[i-1].ID) {
			t.Fatalf("order broken at %d: %+v %+v", i, list[i-1], list[i])
		}
	}
}

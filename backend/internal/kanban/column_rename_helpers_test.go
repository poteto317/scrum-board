package kanban

import "testing"

func TestBuildChangeColumnSQL(t *testing.T) {
	def := "0"
	got := buildChangeColumnSQL("item_numbers", "card_id", "item_id", "bigint", "NO", &def, "")
	want := "ALTER TABLE `item_numbers` CHANGE COLUMN `card_id` `item_id` bigint NOT NULL DEFAULT 0"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	got = buildChangeColumnSQL("t", "a", "b", "varchar(10)", "YES", nil, "")
	want = "ALTER TABLE `t` CHANGE COLUMN `a` `b` varchar(10) NULL"
	if got != want {
		t.Fatalf("nullable: got %q want %q", got, want)
	}
}

func TestPlanIndexRename(t *testing.T) {
	act, _ := planIndexRename("items_column_position", false)
	if act != indexRenameSkip {
		t.Fatalf("non-legacy: %v", act)
	}
	act, name := planIndexRename("fk_card_number", false)
	if act != indexRenameRename || name != "fk_item_number" {
		t.Fatalf("rename: %v %q", act, name)
	}
	act, name = planIndexRename("fk_card_number", true)
	if act != indexRenameDrop || name != "fk_item_number" {
		t.Fatalf("drop: %v %q", act, name)
	}
	act, _ = planIndexRename("task_number", false)
	if act != indexRenameRename {
		t.Fatalf("task_number index: %v", act)
	}
}

func TestClassifyItemNumberChecks(t *testing.T) {
	drop, pos := classifyItemNumberChecks([]checkClause{
		{name: "chk_old", clause: "`task_number` > 0"},
		{name: "chk_new", clause: "`item_number` > 0"},
	})
	if len(drop) != 1 || drop[0] != "chk_old" || !pos {
		t.Fatalf("drop=%v pos=%v", drop, pos)
	}
	drop, pos = classifyItemNumberChecks([]checkClause{
		{name: "chk_task_number_positive", clause: "`item_number`>0"},
	})
	if len(drop) != 1 || drop[0] != "chk_task_number_positive" || pos {
		t.Fatalf("legacy name: drop=%v pos=%v", drop, pos)
	}
	if !itemNumberPositiveClause("`item_number`>0") || !itemNumberPositiveClause("item_number > 0") {
		t.Fatal("positive clause compact match failed")
	}
}

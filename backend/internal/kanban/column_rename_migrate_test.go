package kanban

import (
	"context"
	"strings"
	"testing"
)

func TestRenameCardColumnsToItemsMigratesLegacyNames(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustPrepareColumnRenameTables(t, r)

	mustReverseColumnsToLegacy(t, r)
	mustExec(t, db, `INSERT INTO items(id,column_id,title,description,project_id) VALUES (101,1,'col-rename','',1)`)
	mustExec(t, db, `INSERT INTO item_numbers(card_id,task_number) VALUES (101,42)`)
	mustExec(t, db, `INSERT INTO item_history(card_id,kind,occurred_at,changes,note,evidence_url) VALUES (101,'created',UTC_TIMESTAMP(6),'[]','','')`)
	mustExec(t, db, `INSERT INTO item_pr_links(card_id,position,pr_url) VALUES (101,0,'https://example.com/pr/1')`)

	var beforeID, beforeNum int64
	if err := db.QueryRow(`SELECT card_id, task_number FROM item_numbers WHERE card_id=101`).Scan(&beforeID, &beforeNum); err != nil {
		t.Fatal(err)
	}

	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}

	assertNoLegacyColumns(t, r, "item_numbers", "item_history", "item_pr_links", "item_related_items", "item_command_templates")
	assertNoLegacyConstraintNames(t, r, "item_numbers", "item_history", "item_pr_links", "item_related_items", "item_command_templates")
	assertHasColumn(t, r, "item_numbers", "item_id")
	assertHasColumn(t, r, "item_numbers", "item_number")
	assertFK(t, r, "item_numbers", "fk_item_number")
	assertIndex(t, r, "item_numbers", "item_number")
	assertFK(t, r, "item_history", "fk_history_item")
	assertFK(t, r, "item_pr_links", "fk_item_pr_links_item")
	assertIndex(t, r, "item_pr_links", "uq_item_pr_url")
	assertFK(t, r, "item_related_items", "fk_item_related_owner")
	assertFK(t, r, "item_related_items", "fk_item_related_peer")
	assertIndex(t, r, "item_related_items", "uq_item_related_item")
	assertFK(t, r, "item_command_templates", "fk_item_command_templates_item")
	assertItemNumberPositiveCheck(t, r)

	var afterID, afterNum int64
	if err := db.QueryRow(`SELECT item_id, item_number FROM item_numbers WHERE item_id=101`).Scan(&afterID, &afterNum); err != nil {
		t.Fatal(err)
	}
	if afterID != beforeID || afterNum != beforeNum || afterNum != 42 {
		t.Fatalf("id/number changed: before=%d/%d after=%d/%d", beforeID, beforeNum, afterID, afterNum)
	}
}

func TestRenameCardColumnsToItemsResumesPartialColumnRename(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustPrepareColumnRenameTables(t, r)
	mustReverseColumnsToLegacy(t, r)
	mustExec(t, db, `INSERT INTO items(id,column_id,title,description,project_id) VALUES (202,1,'partial','',1)`)
	mustExec(t, db, `INSERT INTO item_numbers(card_id,task_number) VALUES (202,7)`)

	// Simulate mid-migrate: only card_id→item_id done; task_number still legacy.
	mustExec(t, db, `ALTER TABLE item_numbers DROP FOREIGN KEY fk_card_number`)
	mustExec(t, db, `ALTER TABLE item_numbers CHANGE COLUMN card_id item_id BIGINT NOT NULL`)

	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}
	assertHasColumn(t, r, "item_numbers", "item_id")
	assertHasColumn(t, r, "item_numbers", "item_number")
	assertFK(t, r, "item_numbers", "fk_item_number")
	assertItemNumberPositiveCheck(t, r)
	var n int64
	if err := db.QueryRow(`SELECT item_number FROM item_numbers WHERE item_id=202`).Scan(&n); err != nil || n != 7 {
		t.Fatalf("number=%d err=%v", n, err)
	}
}

func TestRenameCardColumnsToItemsIdempotentAndGreenfield(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustPrepareColumnRenameTables(t, r)

	mustReverseColumnsToLegacy(t, r)
	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatalf("second call: %v", err)
	}

	// Greenfield: tables already use new names from DDL.
	db2 := mysqlTestDB(t, "_fresh")
	r2 := MySQLRepository{DB: db2}
	mustPrepareColumnRenameTables(t, r2)
	assertHasColumn(t, r2, "item_numbers", "item_id")
	if err := r2.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatalf("greenfield no-op: %v", err)
	}
	assertFK(t, r2, "item_numbers", "fk_item_number")
	assertIndex(t, r2, "item_pr_links", "uq_item_pr_url")
}

func TestRenameCardColumnsToItemsRestoresMissingConstraints(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustPrepareColumnRenameTables(t, r)

	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}
	assertFK(t, r, "item_pr_links", "fk_item_pr_links_item")
	assertIndex(t, r, "item_pr_links", "uq_item_pr_url")

	mustExec(t, db, `ALTER TABLE item_pr_links DROP FOREIGN KEY fk_item_pr_links_item`)
	fkOK, err := r.foreignKeyExists(ctx, "item_pr_links", "fk_item_pr_links_item")
	if err != nil || fkOK {
		t.Fatalf("FK should be gone: %v %v", fkOK, err)
	}
	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}
	assertFK(t, r, "item_pr_links", "fk_item_pr_links_item")

	mustExec(t, db, `ALTER TABLE item_pr_links DROP INDEX uq_item_pr_url`)
	idxOK, err := r.indexExists(ctx, "item_pr_links", "uq_item_pr_url")
	if err != nil || idxOK {
		t.Fatalf("UNIQUE should be gone: %v %v", idxOK, err)
	}
	if err := r.RenameCardColumnsToItems(ctx); err != nil {
		t.Fatal(err)
	}
	assertIndex(t, r, "item_pr_links", "uq_item_pr_url")
}

func mustPrepareColumnRenameTables(t *testing.T, r MySQLRepository) {
	t.Helper()
	ctx := context.Background()
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeCommandTemplates(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeItemCommandTemplates(ctx); err != nil {
		t.Fatal(err)
	}
	// PR / related / history already created by mysqlTestDB.
}

// Reverse new DDL column/constraint names back to legacy so migrate can be exercised.
func mustReverseColumnsToLegacy(t *testing.T, r MySQLRepository) {
	t.Helper()
	ctx := context.Background()
	db := r.DB

	type rev struct {
		table string
		fks   []string
		cols  []columnRename // new→old for reverse
		idxs  []struct{ from, to string }
	}
	steps := []rev{
		{
			table: "item_command_templates",
			fks:   []string{"fk_item_command_templates_item"},
			cols:  []columnRename{{"item_id", "card_id"}},
		},
		{
			table: "item_related_items",
			fks:   []string{"fk_item_related_peer", "fk_item_related_owner"},
			cols:  []columnRename{{"related_item_id", "related_card_id"}, {"item_id", "card_id"}},
			idxs:  []struct{ from, to string }{{"uq_item_related_item", "uq_item_related_card"}},
		},
		{
			table: "item_pr_links",
			fks:   []string{"fk_item_pr_links_item"},
			cols:  []columnRename{{"item_id", "card_id"}},
			idxs:  []struct{ from, to string }{{"uq_item_pr_url", "uq_card_pr_url"}},
		},
		{
			table: "item_history",
			fks:   []string{"fk_history_item"},
			cols:  []columnRename{{"item_id", "card_id"}},
		},
		{
			table: "item_numbers",
			fks:   []string{"fk_item_number"},
			cols:  []columnRename{{"item_id", "card_id"}, {"item_number", "task_number"}},
			idxs:  []struct{ from, to string }{{"item_number", "task_number"}},
		},
	}
	for _, s := range steps {
		ok, err := r.tableExists(ctx, s.table)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			continue
		}
		for _, fk := range s.fks {
			exists, err := r.foreignKeyExists(ctx, s.table, fk)
			if err != nil {
				t.Fatal(err)
			}
			if exists {
				mustExec(t, db, "ALTER TABLE `"+s.table+"` DROP FOREIGN KEY `"+fk+"`")
			}
		}
		if s.table == "item_numbers" {
			if err := dropChecksContaining(ctx, r, s.table, "item_number"); err != nil {
				t.Fatal(err)
			}
		}
		for _, c := range s.cols {
			exists, err := r.columnExists(ctx, s.table, c.old)
			if err != nil {
				t.Fatal(err)
			}
			if !exists {
				continue
			}
			if err = r.changeColumn(ctx, s.table, c.old, c.new); err != nil {
				t.Fatalf("reverse %s.%s: %v", s.table, c.old, err)
			}
		}
		for _, idx := range s.idxs {
			exists, err := r.indexExists(ctx, s.table, idx.from)
			if err != nil {
				t.Fatal(err)
			}
			if !exists {
				continue
			}
			mustExec(t, db, "ALTER TABLE `"+s.table+"` RENAME INDEX `"+idx.from+"` TO `"+idx.to+"`")
		}
		// Re-add legacy FKs so migrate must drop them before CHANGE.
		switch s.table {
		case "item_numbers":
			mustExec(t, db, `ALTER TABLE item_numbers ADD CONSTRAINT fk_card_number FOREIGN KEY (card_id) REFERENCES items(id) ON DELETE CASCADE`)
		case "item_history":
			mustExec(t, db, `ALTER TABLE item_history ADD CONSTRAINT fk_history_card FOREIGN KEY (card_id) REFERENCES items(id) ON DELETE CASCADE`)
		case "item_pr_links":
			mustExec(t, db, `ALTER TABLE item_pr_links ADD CONSTRAINT fk_item_pr_links_card FOREIGN KEY (card_id) REFERENCES items(id) ON DELETE CASCADE`)
		case "item_related_items":
			mustExec(t, db, `ALTER TABLE item_related_items ADD CONSTRAINT fk_item_related_owner FOREIGN KEY (card_id) REFERENCES items(id) ON DELETE CASCADE`)
			mustExec(t, db, `ALTER TABLE item_related_items ADD CONSTRAINT fk_item_related_peer FOREIGN KEY (related_card_id) REFERENCES items(id) ON DELETE CASCADE`)
		case "item_command_templates":
			mustExec(t, db, `ALTER TABLE item_command_templates ADD CONSTRAINT fk_item_command_templates_card FOREIGN KEY (card_id) REFERENCES items(id) ON DELETE CASCADE`)
		}
	}

	// Legacy CHECK on task_number if present as item_number check.
	if ok, _ := r.columnExists(ctx, "item_numbers", "task_number"); ok {
		_ = dropChecksContaining(ctx, r, "item_numbers", "item_number")
		var n int
		_ = db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS cc
 JOIN information_schema.TABLE_CONSTRAINTS tc
   ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='item_numbers'
   AND LOWER(cc.CHECK_CLAUSE) LIKE '%task_number%'`).Scan(&n)
		if n == 0 {
			mustExec(t, db, `ALTER TABLE item_numbers ADD CONSTRAINT chk_task_number_positive CHECK (task_number > 0)`)
		}
	}
}

func dropChecksContaining(ctx context.Context, r MySQLRepository, table, needle string) error {
	rows, err := r.DB.QueryContext(ctx, `
SELECT cc.CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS cc
 JOIN information_schema.TABLE_CONSTRAINTS tc
   ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK'
   AND LOWER(cc.CHECK_CLAUSE) LIKE ?`, table, "%"+strings.ToLower(needle)+"%")
	if err != nil {
		return err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return err
		}
		names = append(names, name)
	}
	for _, name := range names {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE `"+table+"` DROP CHECK `"+name+"`"); err != nil {
			return err
		}
	}
	return rows.Err()
}

func assertNoLegacyColumns(t *testing.T, r MySQLRepository, tables ...string) {
	t.Helper()
	ctx := context.Background()
	for _, table := range tables {
		ok, err := r.tableExists(ctx, table)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			continue
		}
		for _, col := range []string{"card_id", "related_card_id", "task_number"} {
			exists, err := r.columnExists(ctx, table, col)
			if err != nil {
				t.Fatal(err)
			}
			if exists {
				t.Fatalf("%s still has %s", table, col)
			}
		}
	}
}

func assertHasColumn(t *testing.T, r MySQLRepository, table, column string) {
	t.Helper()
	ok, err := r.columnExists(context.Background(), table, column)
	if err != nil || !ok {
		t.Fatalf("%s.%s missing: %v %v", table, column, ok, err)
	}
}

func assertFK(t *testing.T, r MySQLRepository, table, name string) {
	t.Helper()
	ok, err := r.foreignKeyExists(context.Background(), table, name)
	if err != nil || !ok {
		t.Fatalf("%s FK %s missing: %v %v", table, name, ok, err)
	}
}

func assertIndex(t *testing.T, r MySQLRepository, table, name string) {
	t.Helper()
	ok, err := r.indexExists(context.Background(), table, name)
	if err != nil || !ok {
		t.Fatalf("%s index %s missing: %v %v", table, name, ok, err)
	}
}

func assertItemNumberPositiveCheck(t *testing.T, r MySQLRepository) {
	t.Helper()
	var n int
	err := r.DB.QueryRow(`
SELECT COUNT(*)
  FROM information_schema.CHECK_CONSTRAINTS cc
  JOIN information_schema.TABLE_CONSTRAINTS tc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'item_numbers' AND tc.CONSTRAINT_TYPE = 'CHECK'
   AND REPLACE(REPLACE(REPLACE(REPLACE(LOWER(cc.CHECK_CLAUSE), ' ', ''), CHAR(96), ''), '(', ''), ')', '') LIKE '%item_number>0%'`).Scan(&n)
	if err != nil || n < 1 {
		t.Fatalf("item_number > 0 CHECK missing: n=%d err=%v", n, err)
	}
}

func assertNoLegacyConstraintNames(t *testing.T, r MySQLRepository, tables ...string) {
	t.Helper()
	ctx := context.Background()
	for _, table := range tables {
		ok, err := r.tableExists(ctx, table)
		if err != nil || !ok {
			continue
		}
		rows, err := r.DB.QueryContext(ctx, `
SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE IN ('FOREIGN KEY','UNIQUE','CHECK')
UNION
SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'`, table, table)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			if legacyConstraintName(name) {
				rows.Close()
				t.Fatalf("%s still has legacy constraint/index %s", table, name)
			}
		}
		rows.Close()
	}
}

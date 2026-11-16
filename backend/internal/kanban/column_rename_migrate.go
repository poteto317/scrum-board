package kanban

import (
	"context"
	"fmt"
	"strings"
)

const renameCardColumnsLock = "scrumboard_rename_card_columns_to_items"

type columnRename struct {
	old, new string
}

type expectedIndex struct {
	name               string
	columns            string // e.g. "(item_id, pr_url)"
	unique             bool
	requireColumn      string // if set, skip ADD until this column exists (e.g. position on multi-URL PR table)
	requireASCIIColumn string // if set, skip ADD unless that column's charset is ascii
}

type expectedFK struct {
	name       string
	column     string
	refTable   string
	refColumn  string
	onDelete   string
}

type tableColumnRename struct {
	table   string
	columns []columnRename
	indexes []expectedIndex
	fks     []expectedFK
	// When set, ensure CHECK (item_number > 0) after column renames.
	ensureItemNumberCheck bool
}

var cardToItemColumnTables = []tableColumnRename{
	{
		table: "item_numbers",
		columns: []columnRename{
			{"card_id", "item_id"},
			{"task_number", "item_number"},
		},
		indexes: []expectedIndex{
			{name: "item_number", columns: "(item_number)", unique: true},
		},
		fks: []expectedFK{
			{name: "fk_item_number", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
		ensureItemNumberCheck: true,
	},
	{
		table: "item_history",
		columns: []columnRename{
			{"card_id", "item_id"},
		},
		indexes: nil, // history_import / history_order keep names; columns update via CHANGE
		fks: []expectedFK{
			{name: "fk_history_item", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
	},
	{
		table: "item_pr_links",
		columns: []columnRename{
			{"card_id", "item_id"},
		},
		indexes: []expectedIndex{
			// Legacy single-URL tables lack position; InitializePRLinks rebuilds ascii UNIQUE.
			{name: "uq_item_pr_url", columns: "(item_id, pr_url)", unique: true, requireColumn: "position", requireASCIIColumn: "pr_url"},
		},
		fks: []expectedFK{
			{name: "fk_item_pr_links_item", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
	},
	{
		table: "item_pr_links__new",
		columns: []columnRename{
			{"card_id", "item_id"},
		},
		indexes: []expectedIndex{
			{name: "uq_item_pr_url", columns: "(item_id, pr_url)", unique: true, requireColumn: "position", requireASCIIColumn: "pr_url"},
		},
		fks: []expectedFK{
			{name: "fk_item_pr_links_item_new", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
	},
	{
		table: "item_related_items",
		columns: []columnRename{
			{"card_id", "item_id"},
			{"related_card_id", "related_item_id"},
		},
		indexes: []expectedIndex{
			{name: "uq_item_related_item", columns: "(item_id, related_item_id)", unique: true},
			{name: "uq_item_related_url", columns: "(item_id, url)", unique: true},
		},
		fks: []expectedFK{
			{name: "fk_item_related_owner", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
			{name: "fk_item_related_peer", column: "related_item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
	},
	{
		table: "item_command_templates",
		columns: []columnRename{
			{"card_id", "item_id"},
		},
		fks: []expectedFK{
			{name: "fk_item_command_templates_item", column: "item_id", refTable: "items", refColumn: "id", onDelete: "CASCADE"},
		},
	},
}

// RenameCardColumnsToItems renames legacy card_id / related_card_id / task_number
// columns and card/task_number constraint names to item_* equivalents.
// Idempotent per column and constraint (L-038). Does not rewrite row ids or numbers (L-456).
func (r MySQLRepository) RenameCardColumnsToItems(ctx context.Context) error {
	var locked int
	// Longer than other migrates (30s): this path may ALTER many tables under one lock.
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK(?, 120)", renameCardColumnsLock).Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("rename card columns lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK(?)", renameCardColumnsLock)

	for _, spec := range cardToItemColumnTables {
		if err := r.renameColumnsOnTable(ctx, spec); err != nil {
			return err
		}
	}
	return nil
}

func (r MySQLRepository) renameColumnsOnTable(ctx context.Context, spec tableColumnRename) error {
	ok, err := r.tableExists(ctx, spec.table)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}

	oldCols := map[string]string{}
	for _, c := range spec.columns {
		oldCols[c.old] = c.new
	}

	if err = r.dropBlockingForeignKeys(ctx, spec.table, oldCols); err != nil {
		return err
	}
	if err = r.dropChecksUsingColumns(ctx, spec.table, oldCols); err != nil {
		return err
	}

	for _, c := range spec.columns {
		exists, err := r.columnExists(ctx, spec.table, c.old)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if err = r.changeColumn(ctx, spec.table, c.old, c.new); err != nil {
			return fmt.Errorf("%s CHANGE %s→%s: %w", spec.table, c.old, c.new, err)
		}
	}

	if err = r.renameLeftoverIndexes(ctx, spec.table); err != nil {
		return err
	}
	if err = r.ensureExpectedIndexes(ctx, spec); err != nil {
		return err
	}
	if err = r.ensureExpectedForeignKeys(ctx, spec); err != nil {
		return err
	}
	if spec.ensureItemNumberCheck {
		if err = r.ensureItemNumberCheck(ctx, spec.table); err != nil {
			return err
		}
	}
	return nil
}

func (r MySQLRepository) ensureExpectedIndexes(ctx context.Context, spec tableColumnRename) error {
	for _, idx := range spec.indexes {
		exists, err := r.indexExists(ctx, spec.table, idx.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if idx.requireColumn != "" {
			ok, err := r.columnExists(ctx, spec.table, idx.requireColumn)
			if err != nil {
				return err
			}
			if !ok {
				continue
			}
		}
		if idx.requireASCIIColumn != "" {
			ascii, err := r.columnCharsetIsASCII(ctx, spec.table, idx.requireASCIIColumn)
			if err != nil {
				return err
			}
			if !ascii {
				continue
			}
		}
		kind := "INDEX"
		if idx.unique {
			kind = "UNIQUE INDEX"
		}
		stmt := fmt.Sprintf("ALTER TABLE `%s` ADD %s `%s` %s", spec.table, kind, idx.name, idx.columns)
		if _, err = r.DB.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("%s add %s: %w", spec.table, idx.name, err)
		}
	}
	return nil
}

func (r MySQLRepository) ensureExpectedForeignKeys(ctx context.Context, spec tableColumnRename) error {
	for _, fk := range spec.fks {
		exists, err := r.foreignKeyExists(ctx, spec.table, fk.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		colExists, err := r.columnExists(ctx, spec.table, fk.column)
		if err != nil {
			return err
		}
		if !colExists {
			continue
		}
		stmt := fmt.Sprintf(
			"ALTER TABLE `%s` ADD CONSTRAINT `%s` FOREIGN KEY (`%s`) REFERENCES `%s`(`%s`) ON DELETE %s",
			spec.table, fk.name, fk.column, fk.refTable, fk.refColumn, fk.onDelete,
		)
		if _, err = r.DB.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("%s add FK %s: %w", spec.table, fk.name, err)
		}
	}
	return nil
}

func (r MySQLRepository) dropBlockingForeignKeys(ctx context.Context, table string, oldCols map[string]string) error {
	rows, err := r.DB.QueryContext(ctx, `
SELECT DISTINCT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.TABLE_CONSTRAINTS tc
    ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
   AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   AND tc.TABLE_NAME = kcu.TABLE_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE()
   AND kcu.TABLE_NAME = ?
   AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'`, table)
	if err != nil {
		return err
	}
	defer rows.Close()

	drop := map[string]struct{}{}
	for rows.Next() {
		var name, col string
		if err = rows.Scan(&name, &col); err != nil {
			return err
		}
		_, isOldCol := oldCols[col]
		if isOldCol || legacyConstraintName(name) {
			drop[name] = struct{}{}
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for name := range drop {
		if _, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE `%s` DROP FOREIGN KEY `%s`", table, name)); err != nil {
			return fmt.Errorf("%s drop FK %s: %w", table, name, err)
		}
	}
	return nil
}

func (r MySQLRepository) dropChecksUsingColumns(ctx context.Context, table string, oldCols map[string]string) error {
	rows, err := r.DB.QueryContext(ctx, `
SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
  FROM information_schema.CHECK_CONSTRAINTS cc
  JOIN information_schema.TABLE_CONSTRAINTS tc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`, table)
	if err != nil {
		return err
	}
	defer rows.Close()
	var drop []string
	for rows.Next() {
		var name, clause string
		if err = rows.Scan(&name, &clause); err != nil {
			return err
		}
		lower := strings.ToLower(clause)
		for old := range oldCols {
			if strings.Contains(lower, strings.ToLower(old)) {
				drop = append(drop, name)
				break
			}
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, name := range drop {
		if _, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE `%s` DROP CHECK `%s`", table, name)); err != nil {
			return fmt.Errorf("%s drop CHECK %s: %w", table, name, err)
		}
	}
	return nil
}

func (r MySQLRepository) changeColumn(ctx context.Context, table, oldName, newName string) error {
	var colType, nullable, extra string
	var defaultVal *string
	err := r.DB.QueryRowContext(ctx, `
SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		table, oldName,
	).Scan(&colType, &nullable, &defaultVal, &extra)
	if err != nil {
		return err
	}
	stmt := buildChangeColumnSQL(table, oldName, newName, colType, nullable, defaultVal, extra)
	_, err = r.DB.ExecContext(ctx, stmt)
	return err
}

func buildChangeColumnSQL(table, oldName, newName, colType, nullable string, defaultVal *string, extra string) string {
	nullSQL := "NULL"
	if nullable == "NO" {
		nullSQL = "NOT NULL"
	}
	defSQL := ""
	if defaultVal != nil {
		defSQL = " DEFAULT " + formatSQLDefault(*defaultVal, colType)
	}
	extraSQL := ""
	if extra != "" {
		extraSQL = " " + extra
	}
	return fmt.Sprintf(
		"ALTER TABLE `%s` CHANGE COLUMN `%s` `%s` %s %s%s%s",
		table, oldName, newName, colType, nullSQL, defSQL, extraSQL,
	)
}

func formatSQLDefault(v, colType string) string {
	upper := strings.ToUpper(colType)
	if strings.Contains(upper, "INT") || strings.Contains(upper, "DECIMAL") || strings.Contains(upper, "FLOAT") || strings.Contains(upper, "DOUBLE") {
		return v
	}
	if strings.EqualFold(v, "CURRENT_TIMESTAMP") || strings.HasPrefix(strings.ToUpper(v), "CURRENT_TIMESTAMP") {
		return v
	}
	return "'" + strings.ReplaceAll(v, "'", "''") + "'"
}

func (r MySQLRepository) renameLeftoverIndexes(ctx context.Context, table string) error {
	rows, err := r.DB.QueryContext(ctx, `
SELECT DISTINCT INDEX_NAME
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'`, table)
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
	if err = rows.Err(); err != nil {
		return err
	}
	for _, name := range names {
		probe, newName := planIndexRename(name, false)
		if probe == indexRenameSkip {
			continue
		}
		exists, err := r.indexExists(ctx, table, newName)
		if err != nil {
			return err
		}
		action, newName := planIndexRename(name, exists)
		switch action {
		case indexRenameDrop:
			if _, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE `%s` DROP INDEX `%s`", table, name)); err != nil {
				return fmt.Errorf("%s drop leftover index %s: %w", table, name, err)
			}
		case indexRenameRename:
			stmt := fmt.Sprintf("ALTER TABLE `%s` RENAME INDEX `%s` TO `%s`", table, name, newName)
			if _, err = r.DB.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("%s RENAME INDEX %s→%s: %w", table, name, newName, err)
			}
		}
	}
	return nil
}

type indexRenameAction int

const (
	indexRenameSkip indexRenameAction = iota
	indexRenameRename
	indexRenameDrop
)

// planIndexRename decides skip / rename / drop for a leftover legacy index name.
// newExists is whether the mapped new name already has an index.
func planIndexRename(name string, newExists bool) (indexRenameAction, string) {
	if !legacyConstraintName(name) {
		return indexRenameSkip, ""
	}
	newName := mapLegacyConstraintName(name)
	if newName == name {
		return indexRenameSkip, ""
	}
	if newExists {
		return indexRenameDrop, newName
	}
	return indexRenameRename, newName
}

func (r MySQLRepository) ensureItemNumberCheck(ctx context.Context, table string) error {
	colOK, err := r.columnExists(ctx, table, "item_number")
	if err != nil {
		return err
	}
	if !colOK {
		return nil
	}
	rows, err := r.DB.QueryContext(ctx, `
SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
  FROM information_schema.CHECK_CONSTRAINTS cc
  JOIN information_schema.TABLE_CONSTRAINTS tc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`, table)
	if err != nil {
		return err
	}
	defer rows.Close()
	var checks []checkClause
	for rows.Next() {
		var name, clause string
		if err = rows.Scan(&name, &clause); err != nil {
			return err
		}
		checks = append(checks, checkClause{name: name, clause: clause})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	dropNames, hasPositive := classifyItemNumberChecks(checks)
	for _, name := range dropNames {
		if _, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE `%s` DROP CHECK `%s`", table, name)); err != nil {
			return fmt.Errorf("%s drop CHECK %s: %w", table, name, err)
		}
	}
	if hasPositive {
		return nil
	}
	// Re-check after drops in case a remaining check already covers item_number > 0.
	var n int
	err = r.DB.QueryRowContext(ctx, `
SELECT COUNT(*)
  FROM information_schema.CHECK_CONSTRAINTS cc
  JOIN information_schema.TABLE_CONSTRAINTS tc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
   AND REPLACE(REPLACE(REPLACE(REPLACE(LOWER(cc.CHECK_CLAUSE), ' ', ''), CHAR(96), ''), '(', ''), ')', '') LIKE '%item_number>0%'`, table).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE `%s` ADD CONSTRAINT chk_item_number_positive CHECK (item_number > 0)", table))
	if err != nil {
		return fmt.Errorf("%s add CHECK item_number > 0: %w", table, err)
	}
	return nil
}

type checkClause struct{ name, clause string }

func classifyItemNumberChecks(checks []checkClause) (dropNames []string, hasPositive bool) {
	for _, c := range checks {
		lower := strings.ToLower(c.clause)
		if strings.Contains(lower, "task_number") || legacyConstraintName(c.name) {
			dropNames = append(dropNames, c.name)
			continue
		}
		if strings.Contains(lower, "item_number") && itemNumberPositiveClause(lower) {
			hasPositive = true
		}
	}
	return dropNames, hasPositive
}

func itemNumberPositiveClause(lowerClause string) bool {
	compact := strings.NewReplacer(" ", "", "`", "", "(", "", ")", "").Replace(lowerClause)
	return strings.Contains(compact, "item_number>0")
}

func legacyConstraintName(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "card") || strings.Contains(lower, "task_number")
}

// mapLegacyConstraintName maps leftover index/constraint names on item_* tables.
// Unlike table renames (explicit pairs), names are few and patterned (fk_*_card, uq_card_*, task_number);
// substring replace is intentional for that closed set after column CHANGE.
func mapLegacyConstraintName(name string) string {
	out := name
	out = strings.ReplaceAll(out, "task_number", "item_number")
	out = strings.ReplaceAll(out, "Task_number", "item_number")
	out = strings.ReplaceAll(out, "card", "item")
	out = strings.ReplaceAll(out, "Card", "Item")
	return out
}

func (r MySQLRepository) columnExists(ctx context.Context, table, column string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, column).Scan(&n)
	return n > 0, err
}

func (r MySQLRepository) columnCharsetIsASCII(ctx context.Context, table, column string) (bool, error) {
	var cs *string
	err := r.DB.QueryRowContext(ctx, `
SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, column).Scan(&cs)
	if err != nil {
		return false, err
	}
	if cs == nil {
		return false, nil
	}
	return strings.EqualFold(*cs, "ascii"), nil
}

func (r MySQLRepository) indexExists(ctx context.Context, table, index string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, table, index).Scan(&n)
	return n > 0, err
}

func (r MySQLRepository) foreignKeyExists(ctx context.Context, table, name string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
		table, name,
	).Scan(&n)
	return n > 0, err
}

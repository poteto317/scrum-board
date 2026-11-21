package kanban

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type localBoardOriginPattern struct {
	source           string
	replacementSlash bool // true: substitute target + "/"; false: substitute target only
}

// Local board origins written during local dev; slash variants are handled first.
var localBoardOriginPatterns = []localBoardOriginPattern{
	{source: "http://127.0.0.1:4200/", replacementSlash: true},
	{source: "http://127.0.0.1:4200", replacementSlash: false},
	{source: "http://localhost:4200/", replacementSlash: true},
	{source: "http://localhost:4200", replacementSlash: false},
}

type originRewriteColumn struct {
	table  string
	column string
}

var originRewriteColumns = []originRewriteColumn{
	{table: "items", column: "description"},
	{table: "items", column: "solution"},
	{table: "items", column: "title"},
	{table: "item_history", column: "note"},
	{table: "item_history", column: "evidence_url"},
	{table: "command_templates", column: "template"},
}

// ContainsLocalBoardOrigin reports whether text mentions a local HTTP board origin.
func ContainsLocalBoardOrigin(text string) bool {
	return strings.Contains(text, "http://127.0.0.1:4200") || strings.Contains(text, "http://localhost:4200")
}

// ReplaceLocalBoardOrigins substitutes known local board origins with replacement (already normalized).
func ReplaceLocalBoardOrigins(text, replacement string) string {
	out := text
	for _, pat := range localBoardOriginPatterns {
		repl := replacement
		if pat.replacementSlash {
			repl = replacement + "/"
		}
		out = strings.ReplaceAll(out, pat.source, repl)
	}
	return out
}

func replacementForPattern(target string, pat localBoardOriginPattern) string {
	if pat.replacementSlash {
		return target + "/"
	}
	return target
}

// ValidateRewriteTarget ensures PUBLIC_ORIGIN is usable for substitution.
func ValidateRewriteTarget(raw string) (string, error) {
	target := NormalizePublicOrigin(raw)
	if target == "" {
		return "", fmt.Errorf("PUBLIC_ORIGIN must be set to a non-empty origin")
	}
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		return "", fmt.Errorf("PUBLIC_ORIGIN must start with http:// or https://")
	}
	return target, nil
}

// RewriteLocalBoardOrigins scans whitelisted text columns and optionally updates rows.
// matchCount is rows containing a local origin per column (same row in two columns counts twice).
// updateCount is rows whose value changed (dry-run leaves updateCount at 0).
func (r MySQLRepository) RewriteLocalBoardOrigins(ctx context.Context, target string, dryRun bool) (matchCount, updateCount int, err error) {
	target, err = ValidateRewriteTarget(target)
	if err != nil {
		return 0, 0, err
	}
	var toUpdate []originRewriteColumn
	for _, col := range originRewriteColumns {
		m, err := r.countLocalBoardOriginMatches(ctx, col.table, col.column)
		if err != nil {
			return matchCount, updateCount, err
		}
		matchCount += m
		if !dryRun && m > 0 {
			toUpdate = append(toUpdate, col)
		}
	}
	if dryRun || len(toUpdate) == 0 {
		return matchCount, updateCount, nil
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return matchCount, updateCount, fmt.Errorf("begin rewrite transaction: %w", err)
	}
	defer tx.Rollback()
	for _, col := range toUpdate {
		u, err := r.applyLocalBoardOriginRewriteTx(ctx, tx, col.table, col.column, target)
		if err != nil {
			return matchCount, updateCount, err
		}
		updateCount += u
	}
	if err := tx.Commit(); err != nil {
		return matchCount, updateCount, fmt.Errorf("commit rewrite transaction: %w", err)
	}
	return matchCount, updateCount, nil
}

func (r MySQLRepository) countLocalBoardOriginMatches(ctx context.Context, table, column string) (int, error) {
	if !isOriginRewriteColumn(table, column) {
		return 0, fmt.Errorf("internal: invalid rewrite column %s.%s", table, column)
	}
	q := fmt.Sprintf(
		`SELECT COUNT(*) FROM %s WHERE %s LIKE '%%http://127.0.0.1:4200%%' OR %s LIKE '%%http://localhost:4200%%'`,
		table, column, column,
	)
	var n int
	if err := r.DB.QueryRowContext(ctx, q).Scan(&n); err != nil {
		return 0, fmt.Errorf("count matches on %s.%s: %w", table, column, err)
	}
	return n, nil
}

func (r MySQLRepository) applyLocalBoardOriginRewriteTx(ctx context.Context, tx *sql.Tx, table, column, target string) (int, error) {
	if !isOriginRewriteColumn(table, column) {
		return 0, fmt.Errorf("internal: invalid rewrite column %s.%s", table, column)
	}
	expr := column
	for range localBoardOriginPatterns {
		expr = fmt.Sprintf("REPLACE(%s, ?, ?)", expr)
	}
	q := fmt.Sprintf(
		`UPDATE %s SET %s = %s WHERE %s LIKE '%%http://127.0.0.1:4200%%' OR %s LIKE '%%http://localhost:4200%%'`,
		table, column, expr, column, column,
	)
	args := make([]any, 0, len(localBoardOriginPatterns)*2)
	for _, pat := range localBoardOriginPatterns {
		args = append(args, pat.source, replacementForPattern(target, pat))
	}
	res, err := tx.ExecContext(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("update %s.%s: %w", table, column, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("rows affected %s.%s: %w", table, column, err)
	}
	return int(affected), nil
}

func isOriginRewriteColumn(table, column string) bool {
	for _, col := range originRewriteColumns {
		if col.table == table && col.column == column {
			return true
		}
	}
	return false
}

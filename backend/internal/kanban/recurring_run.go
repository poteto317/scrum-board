package kanban

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

// RunRecurring evaluates all enabled recurring rules and creates due items.
// Per-rule work runs in its own TX with FOR UPDATE; failures do not stop other rules.
func (r MySQLRepository) RunRecurring(ctx context.Context) (created, skipped, failed int, err error) {
	rules, err := listEnabledRecurringRules(ctx, r.DB)
	if err != nil {
		return 0, 0, 0, err
	}
	now := time.Now().UTC()
	for _, listed := range rules {
		c, s, f := r.runOneRecurringRule(ctx, listed.ID, now)
		created += c
		skipped += s
		failed += f
	}
	return created, skipped, failed, nil
}

// listEnabledRecurringRules is RunRecurring-only (not project-scoped CRUD list).
func listEnabledRecurringRules(ctx context.Context, db *sql.DB) ([]RecurringRule, error) {
	rows, err := db.QueryContext(ctx, `
SELECT id, project_id, name, title, description, cron, timezone, column_id, enabled,
       last_fired_at, created_at, updated_at
FROM recurring_rules WHERE enabled=1
ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecurringRule{}
	for rows.Next() {
		rule, err := scanRecurringRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (r MySQLRepository) runOneRecurringRule(ctx context.Context, id int64, now time.Time) (created, skipped, failed int) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		slog.Error("recurring run begin", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	defer tx.Rollback()

	rule, err := loadRecurringRuleForUpdate(ctx, tx, id)
	if err != nil {
		if err == ErrNotFound {
			return 0, 0, 0
		}
		slog.Error("recurring run lock", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	if !rule.Enabled {
		return 0, 0, 0
	}

	fire, err := shouldFire(rule.Cron, rule.Timezone, rule.LastFiredAt, rule.CreatedAt, now)
	if err != nil {
		slog.Error("recurring run schedule", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	if !fire {
		_ = tx.Commit()
		return 0, 1, 0
	}

	projectID := rule.ProjectID
	_, err = createItemInTx(ctx, tx, ItemInput{
		ColumnID:        rule.ColumnID,
		ProjectID:       &projectID,
		Title:           rule.Title,
		Description:     rule.Description,
		CreatedByUserID: nil,
	})
	if err != nil {
		slog.Error("recurring run create", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	if _, err = tx.ExecContext(ctx, `UPDATE recurring_rules SET last_fired_at=? WHERE id=?`, now, id); err != nil {
		slog.Error("recurring run last_fired_at", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	if err = tx.Commit(); err != nil {
		slog.Error("recurring run commit", "ruleId", id, "error", err)
		return 0, 0, 1
	}
	return 1, 0, 0
}

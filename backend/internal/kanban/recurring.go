package kanban

import (
	"context"
	"database/sql"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxRecurringNameLen  = 80
	defaultRecurringTZ   = "Asia/Tokyo"
)

// RecurringRule is the API shape for a recurring create rule.
type RecurringRule struct {
	ID          int64      `json:"id"`
	ProjectID   int64      `json:"projectId"`
	Name        string     `json:"name"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Cron        string     `json:"cron"`
	Timezone    string     `json:"timezone"`
	ColumnID    int64      `json:"columnId"`
	Enabled     bool       `json:"enabled"`
	LastFiredAt *time.Time `json:"lastFiredAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// RecurringRuleInput is the create payload (handler applies defaults before calling).
type RecurringRuleInput struct {
	Name        string
	Title       string
	Description string
	Cron        string
	Timezone    string
	ColumnID    int64
	Enabled     *bool
}

// RecurringRulePatch is a partial update (omitted fields unchanged; L-002).
type RecurringRulePatch struct {
	Name        *string
	Title       *string
	Description *string
	Cron        *string
	Timezone    *string
	ColumnID    *int64
	Enabled     *bool
}

func normalizeRecurringName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxRecurringNameLen {
		return "", ErrRecurring
	}
	return name, nil
}

func normalizeRecurringTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if !validTitle(title) {
		return "", ErrRecurring
	}
	return title, nil
}

func normalizeRecurringDescription(desc string) (string, error) {
	if !validDescription(desc) {
		return "", ErrRecurring
	}
	return desc, nil
}

// prepareRecurringCreate normalizes create input (pure; no I/O).
func prepareRecurringCreate(in RecurringRuleInput) (RecurringRuleInput, error) {
	name, err := normalizeRecurringName(in.Name)
	if err != nil {
		return RecurringRuleInput{}, err
	}
	title, err := normalizeRecurringTitle(in.Title)
	if err != nil {
		return RecurringRuleInput{}, err
	}
	desc, err := normalizeRecurringDescription(in.Description)
	if err != nil {
		return RecurringRuleInput{}, err
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = defaultRecurringTZ
	}
	cronSpec := strings.TrimSpace(in.Cron)
	if err = validateCronAndTimezone(cronSpec, tz); err != nil {
		return RecurringRuleInput{}, err
	}
	if in.ColumnID <= 0 {
		return RecurringRuleInput{}, ErrColumn
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	en := enabled
	return RecurringRuleInput{
		Name:        name,
		Title:       title,
		Description: desc,
		Cron:        cronSpec,
		Timezone:    tz,
		ColumnID:    in.ColumnID,
		Enabled:     &en,
	}, nil
}

// applyRecurringRulePatch merges a patch into rule (pure; no I/O).
// Column existence must be checked by the caller when ColumnID is set.
func applyRecurringRulePatch(rule RecurringRule, p RecurringRulePatch) (RecurringRule, error) {
	if p.Name != nil {
		name, err := normalizeRecurringName(*p.Name)
		if err != nil {
			return RecurringRule{}, err
		}
		rule.Name = name
	}
	if p.Title != nil {
		title, err := normalizeRecurringTitle(*p.Title)
		if err != nil {
			return RecurringRule{}, err
		}
		rule.Title = title
	}
	if p.Description != nil {
		desc, err := normalizeRecurringDescription(*p.Description)
		if err != nil {
			return RecurringRule{}, err
		}
		rule.Description = desc
	}
	// Only re-validate cron/tz when those fields are patched (L-044 on write).
	// Unchanged invalid stored values must still allow enabled:false etc.
	if p.Cron != nil || p.Timezone != nil {
		cronSpec, tz := rule.Cron, rule.Timezone
		if p.Cron != nil {
			cronSpec = strings.TrimSpace(*p.Cron)
		}
		if p.Timezone != nil {
			tz = strings.TrimSpace(*p.Timezone)
		}
		if err := validateCronAndTimezone(cronSpec, tz); err != nil {
			return RecurringRule{}, err
		}
		rule.Cron, rule.Timezone = cronSpec, tz
	}
	if p.ColumnID != nil {
		if *p.ColumnID <= 0 {
			return RecurringRule{}, ErrColumn
		}
		rule.ColumnID = *p.ColumnID
	}
	if p.Enabled != nil {
		rule.Enabled = *p.Enabled
	}
	return rule, nil
}

func (r MySQLRepository) ListRecurringRules(ctx context.Context, projectID int64) ([]RecurringRule, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, project_id, name, title, description, cron, timezone, column_id, enabled,
       last_fired_at, created_at, updated_at
FROM recurring_rules WHERE project_id=?
ORDER BY id ASC`, projectID)
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

func (r MySQLRepository) CreateRecurringRule(ctx context.Context, projectID int64, in RecurringRuleInput) (RecurringRule, error) {
	fields, err := prepareRecurringCreate(in)
	if err != nil {
		return RecurringRule{}, err
	}
	if projectID <= 0 {
		return RecurringRule{}, ErrProject
	}
	var projectExists int
	if err = r.DB.QueryRowContext(ctx, `SELECT 1 FROM projects WHERE id=?`, projectID).Scan(&projectExists); err != nil {
		if err == sql.ErrNoRows {
			return RecurringRule{}, ErrProject
		}
		return RecurringRule{}, err
	}
	var columnExists int
	if err = r.DB.QueryRowContext(ctx, `SELECT 1 FROM board_columns WHERE id=?`, fields.ColumnID).Scan(&columnExists); err != nil {
		if err == sql.ErrNoRows {
			return RecurringRule{}, ErrColumn
		}
		return RecurringRule{}, err
	}
	res, err := r.DB.ExecContext(ctx, `
INSERT INTO recurring_rules(project_id, name, title, description, cron, timezone, column_id, enabled)
VALUES(?,?,?,?,?,?,?,?)`, projectID, fields.Name, fields.Title, fields.Description, fields.Cron, fields.Timezone, fields.ColumnID, *fields.Enabled)
	if err != nil {
		return RecurringRule{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return RecurringRule{}, err
	}
	return loadRecurringRule(ctx, r.DB, id)
}

func (r MySQLRepository) UpdateRecurringRule(ctx context.Context, projectID, id int64, p RecurringRulePatch) (RecurringRule, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return RecurringRule{}, err
	}
	defer tx.Rollback()
	rule, err := loadRecurringRuleForUpdate(ctx, tx, id)
	if err != nil {
		return RecurringRule{}, err
	}
	if rule.ProjectID != projectID {
		return RecurringRule{}, ErrNotFound
	}
	rule, err = applyRecurringRulePatch(rule, p)
	if err != nil {
		return RecurringRule{}, err
	}
	if p.ColumnID != nil {
		var columnExists int
		if err = tx.QueryRowContext(ctx, `SELECT 1 FROM board_columns WHERE id=?`, rule.ColumnID).Scan(&columnExists); err != nil {
			if err == sql.ErrNoRows {
				return RecurringRule{}, ErrColumn
			}
			return RecurringRule{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `
UPDATE recurring_rules
SET name=?, title=?, description=?, cron=?, timezone=?, column_id=?, enabled=?
WHERE id=? AND project_id=?`,
		rule.Name, rule.Title, rule.Description, rule.Cron, rule.Timezone, rule.ColumnID, rule.Enabled, id, projectID); err != nil {
		return RecurringRule{}, err
	}
	if err = tx.Commit(); err != nil {
		return RecurringRule{}, err
	}
	return loadRecurringRule(ctx, r.DB, id)
}

func (r MySQLRepository) DeleteRecurringRule(ctx context.Context, projectID, id int64) error {
	res, err := r.DB.ExecContext(ctx, `DELETE FROM recurring_rules WHERE id=? AND project_id=?`, id, projectID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func loadRecurringRule(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id int64) (RecurringRule, error) {
	row := db.QueryRowContext(ctx, `
SELECT id, project_id, name, title, description, cron, timezone, column_id, enabled,
       last_fired_at, created_at, updated_at
FROM recurring_rules WHERE id=?`, id)
	rule, err := scanRecurringRule(row)
	if err == sql.ErrNoRows {
		return RecurringRule{}, ErrNotFound
	}
	return rule, err
}

func loadRecurringRuleForUpdate(ctx context.Context, tx *sql.Tx, id int64) (RecurringRule, error) {
	row := tx.QueryRowContext(ctx, `
SELECT id, project_id, name, title, description, cron, timezone, column_id, enabled,
       last_fired_at, created_at, updated_at
FROM recurring_rules WHERE id=? FOR UPDATE`, id)
	rule, err := scanRecurringRule(row)
	if err == sql.ErrNoRows {
		return RecurringRule{}, ErrNotFound
	}
	return rule, err
}

type recurringScanner interface {
	Scan(dest ...any) error
}

func scanRecurringRule(s recurringScanner) (RecurringRule, error) {
	var rule RecurringRule
	var lastFired sql.NullTime
	var enabled int
	err := s.Scan(
		&rule.ID, &rule.ProjectID, &rule.Name, &rule.Title, &rule.Description,
		&rule.Cron, &rule.Timezone, &rule.ColumnID, &enabled, &lastFired,
		&rule.CreatedAt, &rule.UpdatedAt,
	)
	if err != nil {
		return RecurringRule{}, err
	}
	rule.Enabled = enabled != 0
	if lastFired.Valid {
		t := lastFired.Time.UTC()
		rule.LastFiredAt = &t
	}
	rule.CreatedAt = rule.CreatedAt.UTC()
	rule.UpdatedAt = rule.UpdatedAt.UTC()
	return rule, nil
}

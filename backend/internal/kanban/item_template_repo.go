package kanban

import (
	"context"
	"database/sql"
	"errors"
)

func (r MySQLRepository) ListItemTemplatesEnsuringSeeds(ctx context.Context, projectID int64) ([]ItemTemplate, error) {
	if err := r.EnsureItemTemplateSeeds(ctx, projectID); err != nil {
		return nil, err
	}
	return r.ListItemTemplates(ctx, projectID)
}

func (r MySQLRepository) ListItemTemplates(ctx context.Context, projectID int64) ([]ItemTemplate, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, project_id, name, title_template, description_template, position
FROM item_templates WHERE project_id=? ORDER BY position ASC, id ASC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ItemTemplate{}
	for rows.Next() {
		var item ItemTemplate
		if err = rows.Scan(&item.ID, &item.ProjectID, &item.Name, &item.TitleTemplate, &item.DescriptionTemplate, &item.Position); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (r MySQLRepository) EnsureItemTemplateSeeds(ctx context.Context, projectID int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = ensureProjectExistsTx(ctx, tx, projectID); err != nil {
		return err
	}
	if err = lockItemTemplateRows(ctx, tx, projectID); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM item_templates WHERE project_id=?", projectID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return tx.Commit()
	}
	seeds := defaultItemTemplateSeeds()
	for i, seed := range seeds {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO item_templates(project_id, name, title_template, description_template, position)
VALUES(?,?,?,?,?)`, projectID, seed.Name, seed.TitleTemplate, seed.DescriptionTemplate, i); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r MySQLRepository) CreateItemTemplate(ctx context.Context, projectID int64, in ItemTemplateInput) (ItemTemplate, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return ItemTemplate{}, err
	}
	defer tx.Rollback()
	if err = ensureProjectExistsTx(ctx, tx, projectID); err != nil {
		return ItemTemplate{}, err
	}
	if err = lockItemTemplateRows(ctx, tx, projectID); err != nil {
		return ItemTemplate{}, err
	}
	var position int
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(position), -1) + 1 FROM item_templates WHERE project_id=?", projectID).Scan(&position); err != nil {
		return ItemTemplate{}, err
	}
	res, err := tx.ExecContext(ctx, `
INSERT INTO item_templates(project_id, name, title_template, description_template, position)
VALUES(?,?,?,?,?)`, projectID, in.Name, in.TitleTemplate, in.DescriptionTemplate, position)
	if err != nil {
		return ItemTemplate{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return ItemTemplate{}, err
	}
	if err = tx.Commit(); err != nil {
		return ItemTemplate{}, err
	}
	return ItemTemplate{
		ID: id, ProjectID: projectID, Name: in.Name,
		TitleTemplate: in.TitleTemplate, DescriptionTemplate: in.DescriptionTemplate, Position: position,
	}, nil
}

func (r MySQLRepository) UpdateItemTemplate(ctx context.Context, projectID, id int64, p ItemTemplatePatch) (ItemTemplate, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return ItemTemplate{}, err
	}
	defer tx.Rollback()
	var current ItemTemplate
	err = tx.QueryRowContext(ctx, `
SELECT id, project_id, name, title_template, description_template, position
FROM item_templates WHERE id=? AND project_id=? FOR UPDATE`, id, projectID).
		Scan(&current.ID, &current.ProjectID, &current.Name, &current.TitleTemplate, &current.DescriptionTemplate, &current.Position)
	if err != nil {
		return ItemTemplate{}, dbError(err)
	}
	if p.Name != nil {
		current.Name = *p.Name
	}
	if p.TitleTemplate != nil {
		current.TitleTemplate = *p.TitleTemplate
	}
	if p.DescriptionTemplate != nil {
		current.DescriptionTemplate = *p.DescriptionTemplate
	}
	if p.Name != nil || p.TitleTemplate != nil || p.DescriptionTemplate != nil {
		if _, err = tx.ExecContext(ctx, `
UPDATE item_templates SET name=?, title_template=?, description_template=? WHERE id=? AND project_id=?`,
			current.Name, current.TitleTemplate, current.DescriptionTemplate, id, projectID); err != nil {
			return ItemTemplate{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return ItemTemplate{}, err
	}
	return current, nil
}

func (r MySQLRepository) DeleteItemTemplate(ctx context.Context, projectID, id int64) error {
	res, err := r.DB.ExecContext(ctx, "DELETE FROM item_templates WHERE id=? AND project_id=?", id, projectID)
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

func ensureProjectExistsTx(ctx context.Context, tx *sql.Tx, projectID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM projects WHERE id=? FOR UPDATE", projectID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func lockItemTemplateRows(ctx context.Context, tx *sql.Tx, projectID int64) error {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM item_templates WHERE project_id=? ORDER BY id FOR UPDATE", projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}

package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) ListCommandTemplates(ctx context.Context) ([]CommandTemplate, error) {
	rows, err := r.DB.QueryContext(ctx, "SELECT id, name, template, position FROM command_templates ORDER BY position ASC, id ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []CommandTemplate{}
	for rows.Next() {
		var item CommandTemplate
		if err = rows.Scan(&item.ID, &item.Name, &item.Template, &item.Position); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (r MySQLRepository) CreateCommandTemplate(ctx context.Context, in CommandTemplateInput) (CommandTemplate, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return CommandTemplate{}, err
	}
	defer tx.Rollback()
	if err = lockCommandTemplateRows(ctx, tx); err != nil {
		return CommandTemplate{}, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM command_templates").Scan(&count); err != nil {
		return CommandTemplate{}, err
	}
	if count >= MaxCommandTemplates {
		return CommandTemplate{}, ErrCommandTemplateLimit
	}
	var position int
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(position), -1) + 1 FROM command_templates").Scan(&position); err != nil {
		return CommandTemplate{}, err
	}
	res, err := tx.ExecContext(ctx, "INSERT INTO command_templates(name, template, position) VALUES(?,?,?)", in.Name, in.Template, position)
	if err != nil {
		return CommandTemplate{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return CommandTemplate{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommandTemplate{}, err
	}
	return CommandTemplate{ID: id, Name: in.Name, Template: in.Template, Position: position}, nil
}

func (r MySQLRepository) UpdateCommandTemplate(ctx context.Context, id int64, p CommandTemplatePatch) (CommandTemplate, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return CommandTemplate{}, err
	}
	defer tx.Rollback()
	var current CommandTemplate
	err = tx.QueryRowContext(ctx, "SELECT id, name, template, position FROM command_templates WHERE id=? FOR UPDATE", id).
		Scan(&current.ID, &current.Name, &current.Template, &current.Position)
	if err != nil {
		return CommandTemplate{}, dbError(err)
	}
	if p.Name != nil {
		current.Name = *p.Name
	}
	if p.Template != nil {
		current.Template = *p.Template
	}
	if p.Name != nil || p.Template != nil {
		if _, err = tx.ExecContext(ctx, "UPDATE command_templates SET name=?, template=? WHERE id=?", current.Name, current.Template, id); err != nil {
			return CommandTemplate{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return CommandTemplate{}, err
	}
	return current, nil
}

func (r MySQLRepository) DeleteCommandTemplate(ctx context.Context, id int64) error {
	res, err := r.DB.ExecContext(ctx, "DELETE FROM command_templates WHERE id=?", id)
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

func lockCommandTemplateRows(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM command_templates ORDER BY id FOR UPDATE")
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

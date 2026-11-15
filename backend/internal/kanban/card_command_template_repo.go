package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) ListCardCommandTemplates(ctx context.Context, cardID int64) ([]CommandTemplate, error) {
	if err := r.ensureCardExists(ctx, cardID); err != nil {
		return nil, err
	}
	return listCardCommandTemplates(ctx, r.DB, cardID)
}

func (r MySQLRepository) ReplaceCardCommandTemplates(ctx context.Context, cardID int64, templateIDs []int64) ([]CommandTemplate, error) {
	ids := dedupeTemplateIDs(templateIDs)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = ensureCardExistsTx(ctx, tx, cardID); err != nil {
		return nil, err
	}
	if err = validateTemplateIDsTx(ctx, tx, ids); err != nil {
		return nil, err
	}
	if err = replaceCardCommandTemplatesTx(ctx, tx, cardID, ids); err != nil {
		return nil, err
	}
	list, err := listCardCommandTemplates(ctx, tx, cardID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return list, nil
}

func (r MySQLRepository) ListCommandTemplateDefaults(ctx context.Context) ([]int64, error) {
	return listCommandTemplateDefaults(ctx, r.DB)
}

func (r MySQLRepository) ReplaceCommandTemplateDefaults(ctx context.Context, templateIDs []int64) ([]int64, error) {
	ids := dedupeTemplateIDs(templateIDs)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = validateTemplateIDsTx(ctx, tx, ids); err != nil {
		return nil, err
	}
	if err = replaceCommandTemplateDefaultsTx(ctx, tx, ids); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return ids, nil
}

func (r MySQLRepository) ApplyCommandTemplatesToAllCards(ctx context.Context, templateIDs []int64) error {
	ids := dedupeTemplateIDs(templateIDs)
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = validateTemplateIDsTx(ctx, tx, ids); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM cards")
	if err != nil {
		return err
	}
	defer rows.Close()
	var cardIDs []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return err
		}
		cardIDs = append(cardIDs, id)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, cardID := range cardIDs {
		if err = replaceCardCommandTemplatesTx(ctx, tx, cardID, ids); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r MySQLRepository) ensureCardExists(ctx context.Context, cardID int64) error {
	var id int64
	err := r.DB.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=?", cardID).Scan(&id)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	return err
}

func ensureCardExistsTx(ctx context.Context, tx *sql.Tx, cardID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=?", cardID).Scan(&id)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	return err
}

func validateTemplateIDsTx(ctx context.Context, tx *sql.Tx, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	for _, id := range ids {
		var found int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM command_templates WHERE id=?", id).Scan(&found)
		if err == sql.ErrNoRows {
			return ErrUnknownCommandTemplateIDs
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func replaceCardCommandTemplatesTx(ctx context.Context, tx *sql.Tx, cardID int64, ids []int64) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM card_command_templates WHERE card_id=?", cardID); err != nil {
		return err
	}
	for i, templateID := range ids {
		if _, err := tx.ExecContext(ctx, "INSERT INTO card_command_templates(card_id, template_id, position) VALUES(?,?,?)", cardID, templateID, i); err != nil {
			return err
		}
	}
	return nil
}

func replaceCommandTemplateDefaultsTx(ctx context.Context, tx *sql.Tx, ids []int64) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM command_template_defaults"); err != nil {
		return err
	}
	for i, templateID := range ids {
		if _, err := tx.ExecContext(ctx, "INSERT INTO command_template_defaults(template_id, position) VALUES(?,?)", templateID, i); err != nil {
			return err
		}
	}
	return nil
}

func copyCommandTemplateDefaultsToCard(ctx context.Context, tx *sql.Tx, cardID int64) error {
	ids, err := listCommandTemplateDefaults(ctx, tx)
	if err != nil {
		return err
	}
	return replaceCardCommandTemplatesTx(ctx, tx, cardID, ids)
}

type cardCommandQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func listCardCommandTemplates(ctx context.Context, q cardCommandQuerier, cardID int64) ([]CommandTemplate, error) {
	rows, err := q.QueryContext(ctx, `SELECT t.id, t.name, t.template, c.position
FROM card_command_templates c
JOIN command_templates t ON t.id = c.template_id
WHERE c.card_id=?
ORDER BY c.position ASC, t.id ASC`, cardID)
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
	return list, rows.Err()
}

func listCommandTemplateDefaults(ctx context.Context, q cardCommandQuerier) ([]int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT template_id FROM command_template_defaults ORDER BY position ASC, template_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

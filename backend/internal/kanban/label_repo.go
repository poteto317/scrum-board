package kanban

import (
	"context"
	"database/sql"
	"strings"
)

// attachLabels sets Labels (id ASC) on every item; items without labels get an empty slice.
func attachLabels(ctx context.Context, q queryable, items []Item) error {
	for i := range items {
		if items[i].Labels == nil {
			items[i].Labels = []Label{}
		}
	}
	if len(items) == 0 {
		return nil
	}
	ids := make([]any, len(items))
	index := make(map[int64]int, len(items))
	holders := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
		index[it.ID] = i
		holders[i] = "?"
	}
	rows, err := q.QueryContext(ctx, `SELECT il.item_id, l.id, l.name, l.color
FROM item_labels il JOIN labels l ON l.id=il.label_id
WHERE il.item_id IN (`+strings.Join(holders, ",")+`) ORDER BY il.item_id, l.id`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var itemID int64
		var l Label
		if err := rows.Scan(&itemID, &l.ID, &l.Name, &l.Color); err != nil {
			return err
		}
		if i, ok := index[itemID]; ok {
			items[i].Labels = append(items[i].Labels, l)
		}
	}
	return rows.Err()
}

func attachLabel(ctx context.Context, q queryable, c *Item) error {
	items := []Item{*c}
	if err := attachLabels(ctx, q, items); err != nil {
		return err
	}
	*c = items[0]
	return nil
}

func scanLabel(s scanner) (Label, error) {
	var l Label
	err := s.Scan(&l.ID, &l.Name, &l.Color)
	return l, err
}

func (r MySQLRepository) ListLabels(ctx context.Context) ([]Label, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, name, color FROM labels ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		l, err := scanLabel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CreateLabel serializes on board_columns before reading labels so concurrent inserts into an
// empty labels table do not take compatible supremum gap locks and deadlock; the unique
// name_key decides duplicates (L-862).
func (r MySQLRepository) CreateLabel(ctx context.Context, in LabelInput) (Label, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Label{}, err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return Label{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM labels ORDER BY id FOR UPDATE`)
	if err != nil {
		return Label{}, err
	}
	count := 0
	for rows.Next() {
		count++
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return Label{}, err
	}
	rows.Close()
	if count >= MaxWorkspaceLabels {
		return Label{}, ErrLabelLimit
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO labels(name, name_key, color) VALUES(?,?,?)`, in.Name, LabelNameKey(in.Name), in.Color)
	if err != nil {
		return Label{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Label{}, err
	}
	if err = tx.Commit(); err != nil {
		return Label{}, err
	}
	return Label{ID: id, Name: in.Name, Color: in.Color}, nil
}

func (r MySQLRepository) UpdateLabel(ctx context.Context, id int64, p LabelPatch) (Label, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Label{}, err
	}
	defer tx.Rollback()
	cur, err := scanLabel(tx.QueryRowContext(ctx, `SELECT id, name, color FROM labels WHERE id=? FOR UPDATE`, id))
	if err != nil {
		return Label{}, dbError(err)
	}
	if p.Name != nil {
		cur.Name = *p.Name
	}
	if p.Color != nil {
		cur.Color = *p.Color
	}
	if _, err = tx.ExecContext(ctx, `UPDATE labels SET name=?, name_key=?, color=? WHERE id=?`, cur.Name, LabelNameKey(cur.Name), cur.Color, id); err != nil {
		return Label{}, dbError(err)
	}
	if err = tx.Commit(); err != nil {
		return Label{}, err
	}
	return cur, nil
}

func (r MySQLRepository) DeleteLabel(ctx context.Context, id int64) error {
	res, err := r.DB.ExecContext(ctx, `DELETE FROM labels WHERE id=?`, id)
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

// knownLabelIDs is the set of existing label ids.
func knownLabelIDs(ctx context.Context, q queryable) (map[int64]struct{}, error) {
	rows, err := q.QueryContext(ctx, `SELECT id FROM labels`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]struct{}{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = struct{}{}
	}
	return out, rows.Err()
}

// verifyLabelsExistForShareTx checks every id in labels with FOR SHARE before mutating item_labels
// so all item-label writes acquire locks in labels -> item_labels order (matching DeleteLabel).
func verifyLabelsExistForShareTx(ctx context.Context, tx *sql.Tx, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	holders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		holders[i] = "?"
		args[i] = id
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM labels WHERE id IN (`+strings.Join(holders, ",")+`) FOR SHARE`, args...)
	if err != nil {
		return err
	}
	found := 0
	for rows.Next() {
		found++
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if found != len(ids) {
		return ErrUnknownLabel
	}
	return nil
}

func insertItemLabelsRowsTx(ctx context.Context, tx *sql.Tx, itemID int64, ids []int64) error {
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT INTO item_labels(item_id, label_id) VALUES(?,?)`, itemID, id); err != nil {
			return dbError(err)
		}
	}
	return nil
}

// insertItemLabelsTx verifies every label exists (FOR SHARE) and inserts rows for a newly created item.
// Separating insert from replace avoids an unnecessary DELETE gap lock on concurrent POST /api/items.
func insertItemLabelsTx(ctx context.Context, tx *sql.Tx, itemID int64, labelIDs []int64) error {
	ids := dedupeInt64s(labelIDs)
	if len(ids) == 0 {
		return nil
	}
	if err := verifyLabelsExistForShareTx(ctx, tx, ids); err != nil {
		return err
	}
	return insertItemLabelsRowsTx(ctx, tx, itemID, ids)
}

// replaceItemLabelsTx replaces the item's labels inside tx. The caller has locked the item row.
// Verify label existence (labels FOR SHARE) before DELETE FROM item_labels so lock order stays
// board_columns -> items -> labels -> item_labels and never deadlocks with DeleteLabel.
func replaceItemLabelsTx(ctx context.Context, tx *sql.Tx, itemID int64, labelIDs []int64) error {
	ids := dedupeInt64s(labelIDs)
	if err := verifyLabelsExistForShareTx(ctx, tx, ids); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM item_labels WHERE item_id=?`, itemID); err != nil {
		return err
	}
	return insertItemLabelsRowsTx(ctx, tx, itemID, ids)
}

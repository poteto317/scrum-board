package kanban

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/go-sql-driver/mysql"
)

type MySQLRepository struct{ DB *sql.DB }

func dbError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	var m *mysql.MySQLError
	if errors.As(err, &m) {
		switch m.Number {
		case 1062:
			return ErrDuplicate
		case 1452:
			return ErrColumn
		}
	}
	return err
}

type scanner interface{ Scan(...any) error }

func scanCard(s scanner) (Card, error) {
	var c Card
	err := s.Scan(&c.ID, &c.Number, &c.ColumnID, &c.Title, &c.Description, &c.Position, &c.BacklogPosition, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, dbError(err)
	}
	c.PRURLs = []string{}
	return c, nil
}

// numberedCards は card_pr_links を結合しない。PR リンクは 1 カード複数行なので、
// 結合すると PR の数だけカードが重複する。PR URL は attachPRURL(s) で別クエリで付ける。
// FOR UPDATE で使っても結合先の行までロックしない。
const cardFields = "c.id, n.task_number, c.column_id, c.title, c.description, c.position, c.backlog_position, c.created_at, c.updated_at"
const numberedCards = " FROM cards c JOIN card_numbers n ON n.card_id=c.id"

func loadCard(ctx context.Context, q interface {
	queryable
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, query string, args ...any) (Card, error) {
	c, err := scanCard(q.QueryRowContext(ctx, query, args...))
	if err != nil {
		return c, err
	}
	if err = attachPRURL(ctx, q, &c); err != nil {
		return c, err
	}
	return c, nil
}

func (r MySQLRepository) Board(ctx context.Context) (Board, error) {
	b := Board{Columns: []Column{}, Cards: []Card{}}
	// A consistent snapshot prevents a concurrent column/card creation from splitting the board response.
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	b.Columns, err = listOrderedColumns(ctx, tx)
	if err != nil {
		return b, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" ORDER BY c.position,c.id")
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		c, e := scanCard(rows)
		if e != nil {
			return b, e
		}
		b.Cards = append(b.Cards, c)
	}
	if err = rows.Err(); err != nil {
		return b, err
	}
	rows.Close()
	if err = attachPRURLs(ctx, tx, b.Cards); err != nil {
		return b, err
	}
	return b, tx.Commit()
}
func (r MySQLRepository) GetCard(ctx context.Context, id int64) (Card, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
}
func (r MySQLRepository) GetCardByNumber(ctx context.Context, number int64) (Card, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE n.task_number=?", number)
}
func (r MySQLRepository) CreateCard(ctx context.Context, in CardInput) (Card, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Card{}, err
	}
	defer tx.Rollback()
	number, err := lockNextNumber(ctx, tx)
	if err != nil {
		return Card{}, err
	}
	if err = lockExistingColumn(ctx, tx, in.ColumnID); err != nil {
		return Card{}, err
	}
	nextPos, err := nextCardPosition(ctx, tx, in.ColumnID)
	if err != nil {
		return Card{}, err
	}
	nextBacklog, err := nextBacklogPosition(ctx, tx)
	if err != nil {
		return Card{}, err
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO cards(column_id,title,description,position,backlog_position) VALUES(?,?,?,?,?)", in.ColumnID, in.Title, in.Description, nextPos, nextBacklog)
	if err != nil {
		return Card{}, dbError(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Card{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO card_numbers(card_id,task_number) VALUES(?,?)", id, number); err != nil {
		return Card{}, dbError(err)
	}
	if _, err = tx.ExecContext(ctx, "UPDATE card_number_sequence SET next_number=? WHERE singleton=1", number+1); err != nil {
		return Card{}, err
	}
	if err = replacePRURLs(ctx, tx, id, in.PRURLs); err != nil {
		return Card{}, err
	}
	card, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return Card{}, err
	}
	if err = appendHistory(ctx, tx, nil, card, "created"); err != nil {
		return Card{}, err
	}
	return card, tx.Commit()
}
func (r MySQLRepository) UpdateCard(ctx context.Context, id int64, p CardPatch) (Card, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Card{}, err
	}
	defer tx.Rollback()
	// A column move takes the same all-columns lock as ReorderCards/CreateCard before touching any card (DeleteCard does too), so
	// InnoDB never sees two writers wait on each other's card and column rows. A PR-link rewrite takes it too:
	// replacePRURLs DELETEs a range that is empty for a card's first save and then INSERTs into it, and two such
	// transactions on different cards each hold the gap lock the other's INSERT waits for (deadlock, 1213).
	// A title/description-only edit does not touch card_pr_links, so it still locks just the owning card below.
	switch {
	case p.ColumnID != nil:
		if err = lockExistingColumn(ctx, tx, *p.ColumnID); err != nil {
			return Card{}, err
		}
	case p.PRURLs != nil:
		if _, err = lockColumnRows(ctx, tx); err != nil {
			return Card{}, err
		}
	}
	var lockedID int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", id).Scan(&lockedID); err != nil {
		return Card{}, dbError(err)
	}
	c, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return c, err
	}
	before := c
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	moved := false
	sourceColumnID := c.ColumnID
	if p.ColumnID != nil && *p.ColumnID != c.ColumnID {
		nextPos, err := nextCardPosition(ctx, tx, *p.ColumnID)
		if err != nil {
			return Card{}, err
		}
		c.ColumnID = *p.ColumnID
		c.Position = nextPos
		moved = true
	}
	_, err = tx.ExecContext(ctx, "UPDATE cards SET title=?,description=?,column_id=?,position=?,updated_at=? WHERE id=?", c.Title, c.Description, c.ColumnID, c.Position, time.Now().UTC(), id)
	if err != nil {
		return Card{}, dbError(err)
	}
	if p.PRURLs != nil {
		if err = replacePRURLs(ctx, tx, id, *p.PRURLs); err != nil {
			return Card{}, err
		}
	}
	if moved {
		if err = compactColumnPositions(ctx, tx, sourceColumnID); err != nil {
			return Card{}, err
		}
	}
	c, err = loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return c, err
	}
	if err = appendHistory(ctx, tx, &before, c, "updated"); err != nil {
		return Card{}, err
	}
	return c, tx.Commit()
}
func (r MySQLRepository) DeleteCard(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// DELETE locks the primary key and then cards_column_position, the opposite of the secondary-then-primary
	// order of the column scans in lockCardsInColumns/nextCardPosition, so it joins the all-columns lock too.
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, "DELETE FROM cards WHERE id=?", id)
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
	return tx.Commit()
}
func (r MySQLRepository) CreateColumn(ctx context.Context, name string) (Column, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Column{}, err
	}
	defer tx.Rollback()
	existing, err := lockColumnRows(ctx, tx)
	if err != nil {
		return Column{}, err
	}
	maxPos := -1
	for _, col := range existing {
		if col.Position > maxPos {
			maxPos = col.Position
		}
	}
	nextPos := maxPos + 1
	res, err := tx.ExecContext(ctx, "INSERT INTO board_columns(name,position) VALUES(?,?)", name, nextPos)
	if err != nil {
		return Column{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Column{}, err
	}
	var c Column
	if err = tx.QueryRowContext(ctx, "SELECT id,name,position FROM board_columns WHERE id=?", id).Scan(&c.ID, &c.Name, &c.Position); err != nil {
		return Column{}, err
	}
	return c, tx.Commit()
}

func (r MySQLRepository) GetColumnByName(ctx context.Context, name string) (Column, error) {
	var column Column
	err := r.DB.QueryRowContext(ctx, "SELECT id,name,position FROM board_columns WHERE name=?", name).Scan(&column.ID, &column.Name, &column.Position)
	if errors.Is(err, sql.ErrNoRows) {
		return Column{}, ErrColumn
	}
	return column, err
}

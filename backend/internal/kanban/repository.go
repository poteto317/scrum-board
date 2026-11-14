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
	err := s.Scan(&c.ID, &c.Number, &c.ColumnID, &c.Title, &c.Description, &c.BacklogPosition, &c.CreatedAt, &c.UpdatedAt, &c.PRURL)
	return c, dbError(err)
}

const cardFields = "c.id, n.task_number, c.column_id, c.title, c.description, c.backlog_position, c.created_at, c.updated_at, COALESCE(p.pr_url,'')"
const numberedCards = " FROM cards c JOIN card_numbers n ON n.card_id=c.id LEFT JOIN card_pr_links p ON p.card_id=c.id"

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
	rows, err := tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" ORDER BY c.created_at,c.id")
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
	return b, tx.Commit()
}
func (r MySQLRepository) GetCard(ctx context.Context, id int64) (Card, error) {
	return scanCard(r.DB.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
}
func (r MySQLRepository) GetCardByNumber(ctx context.Context, number int64) (Card, error) {
	return scanCard(r.DB.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE n.task_number=?", number))
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
	nextBacklog, err := nextBacklogPosition(ctx, tx)
	if err != nil {
		return Card{}, err
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO cards(column_id,title,description,backlog_position) VALUES(?,?,?,?)", in.ColumnID, in.Title, in.Description, nextBacklog)
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
	if in.PRURL != "" {
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_pr_links(card_id,pr_url) VALUES(?,?)", id, in.PRURL); err != nil {
			return Card{}, err
		}
	}
	card, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
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
	// Lock only the owning card. Locking an absent LEFT JOIN row takes a gap lock
	// and can deadlock independent cards during their first PR-link INSERT.
	var lockedID int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", id).Scan(&lockedID); err != nil {
		return Card{}, dbError(err)
	}
	c, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
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
	if p.ColumnID != nil {
		c.ColumnID = *p.ColumnID
	}
	_, err = tx.ExecContext(ctx, "UPDATE cards SET title=?,description=?,column_id=?,updated_at=? WHERE id=?", c.Title, c.Description, c.ColumnID, time.Now().UTC(), id)
	if err != nil {
		return Card{}, dbError(err)
	}
	if p.PRURL != nil {
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_pr_links(card_id,pr_url) VALUES(?,?) ON DUPLICATE KEY UPDATE pr_url=?", id, *p.PRURL, *p.PRURL); err != nil {
			return Card{}, err
		}
	}
	c, err = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
	if err != nil {
		return c, err
	}
	if err = appendHistory(ctx, tx, &before, c, "updated"); err != nil {
		return Card{}, err
	}
	return c, tx.Commit()
}
func (r MySQLRepository) DeleteCard(ctx context.Context, id int64) error {
	res, err := r.DB.ExecContext(ctx, "DELETE FROM cards WHERE id=?", id)
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

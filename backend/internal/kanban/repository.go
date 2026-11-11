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
	err := s.Scan(&c.ID, &c.Number, &c.ColumnID, &c.Title, &c.Description, &c.CreatedAt, &c.UpdatedAt)
	return c, dbError(err)
}

const cardFields = "c.id, n.task_number, c.column_id, c.title, c.description, c.created_at, c.updated_at"
const numberedCards = " FROM cards c JOIN card_numbers n ON n.card_id=c.id"

func (r MySQLRepository) Board(ctx context.Context) (Board, error) {
	b := Board{Columns: []Column{}, Cards: []Card{}}
	// A consistent snapshot prevents a concurrent column/card creation from splitting the board response.
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT id,name,position FROM board_columns ORDER BY position,id")
	if err != nil {
		return b, err
	}
	for rows.Next() {
		var c Column
		if err = rows.Scan(&c.ID, &c.Name, &c.Position); err != nil {
			rows.Close()
			return b, err
		}
		b.Columns = append(b.Columns, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return b, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" ORDER BY c.created_at,c.id")
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
	result, err := tx.ExecContext(ctx, "INSERT INTO cards(column_id,title,description) VALUES(?,?,?)", in.ColumnID, in.Title, in.Description)
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
	card, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
	if err != nil {
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
	c, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=? FOR UPDATE", id))
	if err != nil {
		return c, err
	}
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
	c, err = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
	if err != nil {
		return c, err
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
	// AUTO_INCREMENT also provides stable append order without a MAX(position) race.
	res, err := r.DB.ExecContext(ctx, "INSERT INTO board_columns(name) VALUES(?)", name)
	if err != nil {
		return Column{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Column{}, err
	}
	var c Column
	err = r.DB.QueryRowContext(ctx, "SELECT id,name,position FROM board_columns WHERE id=?", id).Scan(&c.ID, &c.Name, &c.Position)
	return c, err
}

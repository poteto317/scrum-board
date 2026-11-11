package kanban

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrColumn    = errors.New("unknown column")
	ErrDuplicate = errors.New("duplicate column")
)

type Column struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}
type Card struct {
	ID          int64     `json:"id"`
	ColumnID    int64     `json:"columnId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type Board struct {
	Columns []Column `json:"columns"`
	Cards   []Card   `json:"cards"`
}
type CardInput struct {
	ColumnID    int64  `json:"columnId"`
	Title       string `json:"title"`
	Description string `json:"description"`
}
type CardPatch struct {
	ColumnID    *int64  `json:"columnId"`
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

// Repository keeps HTTP independent of MySQL, so handlers can be tested without a database.
type Repository interface {
	Board(context.Context) (Board, error)
	GetCard(context.Context, int64) (Card, error)
	CreateCard(context.Context, CardInput) (Card, error)
	UpdateCard(context.Context, int64, CardPatch) (Card, error)
	DeleteCard(context.Context, int64) error
	CreateColumn(context.Context, string) (Column, error)
}

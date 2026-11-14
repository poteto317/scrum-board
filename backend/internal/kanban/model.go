package kanban

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound          = errors.New("not found")
	ErrColumn            = errors.New("unknown column")
	ErrDuplicate         = errors.New("duplicate column")
	ErrColumnOrder       = errors.New("invalid column order")
	ErrColumnMismatch    = errors.New("column set mismatch")
	ErrCardOrder         = errors.New("invalid card order")
	ErrCardOrderMismatch = errors.New("card set mismatch")
	ErrBacklogOrder      = errors.New("invalid backlog order")
	ErrBacklogMismatch   = errors.New("backlog set mismatch")
)

type Column struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}
type Card struct {
	Number          int64     `json:"number"`
	ID              int64     `json:"id"`
	ColumnID        int64     `json:"columnId"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	Position        int       `json:"position"`
	BacklogPosition int       `json:"backlogPosition"`
	PRURLs          []string  `json:"prUrls"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type CardColumnOrder struct {
	ColumnID int64   `json:"columnId"`
	CardIDs  []int64 `json:"cardIds"`
}
type Board struct {
	Columns []Column `json:"columns"`
	Cards   []Card   `json:"cards"`
}
type CardInput struct {
	ColumnID    int64    `json:"columnId"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	PRURLs      []string `json:"prUrls"`
}
type CardPatch struct {
	ColumnID    *int64    `json:"columnId"`
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	PRURLs      *[]string `json:"prUrls"`
}

// Repository keeps HTTP independent of MySQL, so handlers can be tested without a database.
type Repository interface {
	Board(context.Context) (Board, error)
	History(context.Context, int64, int64) (HistoryPage, error)
	GetCard(context.Context, int64) (Card, error)
	GetCardByNumber(context.Context, int64) (Card, error)
	GetColumnByName(context.Context, string) (Column, error)
	CreateCard(context.Context, CardInput) (Card, error)
	UpdateCard(context.Context, int64, CardPatch) (Card, error)
	DeleteCard(context.Context, int64) error
	CreateColumn(context.Context, string) (Column, error)
	ReorderColumns(context.Context, []int64) ([]Column, error)
	ReorderCards(context.Context, []CardColumnOrder) ([]Card, error)
	Backlog(context.Context) ([]Card, error)
	ReorderBacklog(context.Context, []int64) ([]Card, error)
}

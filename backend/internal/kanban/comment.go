package kanban

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	maxCommentAuthorLen = 60
	maxCommentBodyLen   = 4000
)

// Comment is one flat note on an item (Notion-like page comment).
type Comment struct {
	ID        int64     `json:"id"`
	ItemID    int64     `json:"itemId"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// NormalizeCommentAuthor trims and accepts empty (anonymous). ok is false when too long or control chars.
func NormalizeCommentAuthor(raw string) (value string, ok bool) {
	value = strings.TrimSpace(raw)
	if utf8.RuneCountInString(value) > maxCommentAuthorLen {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return value, true
}

// NormalizeCommentBody trims; empty after trim is invalid. ok is false when empty, too long, or control chars.
func NormalizeCommentBody(raw string) (value string, ok bool) {
	value = strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	if utf8.RuneCountInString(value) > maxCommentBodyLen {
		return "", false
	}
	for _, r := range value {
		// Allow newline / carriage return so textarea multiline bodies work.
		if unicode.IsControl(r) && r != '\n' && r != '\r' {
			return "", false
		}
	}
	return value, true
}

func (r MySQLRepository) ListComments(ctx context.Context, itemID int64) ([]Comment, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, item_id, author, body, created_at, updated_at
 FROM item_comments WHERE item_id=? ORDER BY created_at ASC, id ASC`, itemID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()
	out := make([]Comment, 0)
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r MySQLRepository) CreateComment(ctx context.Context, itemID int64, author, body string) (Comment, error) {
	res, err := r.DB.ExecContext(ctx, `INSERT INTO item_comments(item_id, author, body) VALUES (?,?,?)`, itemID, author, body)
	if err != nil {
		return Comment{}, fmt.Errorf("create comment: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Comment{}, err
	}
	return r.getComment(ctx, itemID, id)
}

func (r MySQLRepository) UpdateComment(ctx context.Context, itemID, commentID int64, author, body *string) (Comment, error) {
	cur, err := r.getComment(ctx, itemID, commentID)
	if err != nil {
		return Comment{}, err
	}
	nextAuthor, nextBody := cur.Author, cur.Body
	if author != nil {
		nextAuthor = *author
	}
	if body != nil {
		nextBody = *body
	}
	_, err = r.DB.ExecContext(ctx, `UPDATE item_comments SET author=?, body=? WHERE id=? AND item_id=?`,
		nextAuthor, nextBody, commentID, itemID)
	if err != nil {
		return Comment{}, fmt.Errorf("update comment: %w", err)
	}
	return r.getComment(ctx, itemID, commentID)
}

func (r MySQLRepository) DeleteComment(ctx context.Context, itemID, commentID int64) error {
	res, err := r.DB.ExecContext(ctx, `DELETE FROM item_comments WHERE id=? AND item_id=?`, commentID, itemID)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
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

func (r MySQLRepository) getComment(ctx context.Context, itemID, commentID int64) (Comment, error) {
	row := r.DB.QueryRowContext(ctx, `SELECT id, item_id, author, body, created_at, updated_at
 FROM item_comments WHERE id=? AND item_id=?`, commentID, itemID)
	c, err := scanComment(row)
	if err == sql.ErrNoRows {
		return Comment{}, ErrNotFound
	}
	if err != nil {
		return Comment{}, fmt.Errorf("get comment: %w", err)
	}
	return c, nil
}

type commentScanner interface {
	Scan(dest ...any) error
}

func scanComment(s commentScanner) (Comment, error) {
	var c Comment
	err := s.Scan(&c.ID, &c.ItemID, &c.Author, &c.Body, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

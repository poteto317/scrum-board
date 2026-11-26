package kanban

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ProjectAIMessage is one stored message of a user's AI chat in a project.
// The owner's user id is not part of the JSON: a history is always the caller's own.
type ProjectAIMessage struct {
	ID           int64     `json:"id"`
	ProjectID    int64     `json:"projectId"`
	Role         string    `json:"role"`
	Body         string    `json:"body"`
	InputTokens  *int      `json:"inputTokens,omitempty"`
	OutputTokens *int      `json:"outputTokens,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// tokenCountPtr stores a token count only when the provider reported one.
func tokenCountPtr(n int64) *int {
	if n <= 0 {
		return nil
	}
	v := int(n)
	return &v
}

// ListProjectAIMessages returns one user's history in one project, oldest first.
func (r MySQLRepository) ListProjectAIMessages(ctx context.Context, projectID, userID int64) ([]ProjectAIMessage, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, project_id, role, body, input_tokens, output_tokens, created_at
 FROM project_ai_messages WHERE project_id=? AND user_id=? ORDER BY created_at ASC, id ASC`, projectID, userID)
	if err != nil {
		return nil, fmt.Errorf("list project ai messages: %w", err)
	}
	defer rows.Close()
	out := make([]ProjectAIMessage, 0)
	for rows.Next() {
		var m ProjectAIMessage
		var inTok, outTok sql.NullInt64
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.Role, &m.Body, &inTok, &outTok, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan project ai message: %w", err)
		}
		if inTok.Valid {
			m.InputTokens = tokenCountPtr(inTok.Int64)
		}
		if outTok.Valid {
			m.OutputTokens = tokenCountPtr(outTok.Int64)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AppendProjectAITurn stores one exchange (the user's message and the final answer) in one
// transaction and drops the oldest messages of that project × user beyond maxAIChatStoredMessages.
func (r MySQLRepository) AppendProjectAITurn(ctx context.Context, projectID, userID int64, userBody, assistantBody string, inTok, outTok int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_ai_messages WHERE project_id=? AND user_id=?`, projectID, userID).Scan(&count); err != nil {
		return fmt.Errorf("count project ai messages: %w", err)
	}
	if overflow := count + 2 - maxAIChatStoredMessages; overflow > 0 {
		if _, err = tx.ExecContext(ctx, `DELETE FROM project_ai_messages WHERE project_id=? AND user_id=? ORDER BY created_at ASC, id ASC LIMIT ?`, projectID, userID, overflow); err != nil {
			return fmt.Errorf("trim project ai messages: %w", err)
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, role, body) VALUES (?,?,?,?)`, projectID, userID, AIRoleUser, userBody); err != nil {
		return fmt.Errorf("append user project ai message: %w", err)
	}
	var inPtr, outPtr any
	if inTok > 0 {
		inPtr = int(inTok)
	}
	if outTok > 0 {
		outPtr = int(outTok)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, role, body, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)`,
		projectID, userID, AIRoleAssistant, assistantBody, inPtr, outPtr); err != nil {
		return fmt.Errorf("append assistant project ai message: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("append project ai turn: %w", err)
	}
	return nil
}

// ClearProjectAIMessages deletes one user's history in one project. Other users and projects are untouched.
func (r MySQLRepository) ClearProjectAIMessages(ctx context.Context, projectID, userID int64) error {
	if _, err := r.DB.ExecContext(ctx, `DELETE FROM project_ai_messages WHERE project_id=? AND user_id=?`, projectID, userID); err != nil {
		return fmt.Errorf("clear project ai messages: %w", err)
	}
	return nil
}

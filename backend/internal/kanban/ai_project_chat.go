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
	ID             int64     `json:"id"`
	ProjectID      int64     `json:"projectId"`
	ConversationID int64     `json:"conversationId"`
	Role           string    `json:"role"`
	Body           string    `json:"body"`
	InputTokens    *int      `json:"inputTokens,omitempty"`
	OutputTokens   *int      `json:"outputTokens,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

// tokenCountPtr stores a token count only when the provider reported one.
func tokenCountPtr(n int64) *int {
	if n <= 0 {
		return nil
	}
	v := int(n)
	return &v
}

// ListProjectAIMessages returns the messages of one conversation, oldest first. The owner is
// stored on the message too (not only on the conversation), so all three narrow the read.
// A message without a conversation (written by an older server during a rollout) is in no
// conversation until the next start adopts it.
func (r MySQLRepository) ListProjectAIMessages(ctx context.Context, projectID, userID, conversationID int64) ([]ProjectAIMessage, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, project_id, conversation_id, role, body, input_tokens, output_tokens, created_at
 FROM project_ai_messages WHERE conversation_id=? AND project_id=? AND user_id=? ORDER BY created_at ASC, id ASC`, conversationID, projectID, userID)
	if err != nil {
		return nil, fmt.Errorf("list project ai messages: %w", err)
	}
	defer rows.Close()
	out := make([]ProjectAIMessage, 0)
	for rows.Next() {
		var m ProjectAIMessage
		var inTok, outTok sql.NullInt64
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.ConversationID, &m.Role, &m.Body, &inTok, &outTok, &m.CreatedAt); err != nil {
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

// ClearProjectAIConversations deletes all of one user's conversations in one project, and that
// user's messages there that are in no conversation yet. Other users and projects are untouched.
// The conversations go first: the same lock order as AppendProjectAITurn (conversation, then messages).
func (r MySQLRepository) ClearProjectAIConversations(ctx context.Context, projectID, userID int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM project_ai_conversations WHERE project_id=? AND user_id=?`, projectID, userID); err != nil {
		return fmt.Errorf("clear project ai conversations: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM project_ai_messages WHERE project_id=? AND user_id=?`, projectID, userID); err != nil {
		return fmt.Errorf("clear project ai messages: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("clear project ai chat: %w", err)
	}
	return nil
}

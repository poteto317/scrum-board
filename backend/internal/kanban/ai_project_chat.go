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
	// Proposals are the answer's proposals (assistant messages only), oldest first.
	Proposals []ProjectAIProposal `json:"proposals,omitempty"`
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
	out, err := r.scanProjectAIMessages(ctx, projectID, userID, conversationID)
	if err != nil {
		return nil, err
	}
	// Read after the messages' rows are closed: the proposals are a second query.
	if err := r.attachProjectAIProposals(ctx, projectID, userID, conversationID, out); err != nil {
		return nil, err
	}
	return out, nil
}

// scanProjectAIMessages reads the conversation's messages (without their proposals).
func (r MySQLRepository) scanProjectAIMessages(ctx context.Context, projectID, userID, conversationID int64) ([]ProjectAIMessage, error) {
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

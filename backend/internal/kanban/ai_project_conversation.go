package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// maxProjectAIConversations is how many conversations one user keeps in one project.
const maxProjectAIConversations = 100

// projectAIConversationsOverLimit is how many of count conversations are beyond what one
// user keeps in one project (never negative).
func projectAIConversationsOverLimit(count int) int {
	return max(count-maxProjectAIConversations, 0)
}

// projectAIMessagesOverLimit is how many of a conversation's count messages must go so that
// it holds at most maxAIChatStoredMessages once adding more are stored (never negative).
func projectAIMessagesOverLimit(count, adding int) int {
	return max(count+adding-maxAIChatStoredMessages, 0)
}

// ProjectAIConversation is one thread of a user's AI chat in a project. Like the messages,
// it is always the caller's own: the owner's user id is not part of the JSON.
type ProjectAIConversation struct {
	ID        int64     `json:"id"`
	ProjectID int64     `json:"projectId"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const projectAIConversationColumns = `id, project_id, title, created_at, updated_at`

// projectAIConversationOrder is "newest first": the first row is the latest conversation.
const projectAIConversationOrder = ` ORDER BY updated_at DESC, id DESC`

func scanProjectAIConversation(row scanner) (ProjectAIConversation, error) {
	var c ProjectAIConversation
	err := row.Scan(&c.ID, &c.ProjectID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// ListProjectAIConversations returns one user's conversations in one project, newest update
// first. The owner is part of the WHERE, before the LIMIT: what the caller may not see is
// neither returned nor counted.
func (r MySQLRepository) ListProjectAIConversations(ctx context.Context, projectID, userID int64) ([]ProjectAIConversation, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT `+projectAIConversationColumns+` FROM project_ai_conversations
 WHERE project_id=? AND user_id=?`+projectAIConversationOrder+` LIMIT ?`, projectID, userID, maxProjectAIConversations)
	if err != nil {
		return nil, fmt.Errorf("list project ai conversations: %w", err)
	}
	defer rows.Close()
	out := make([]ProjectAIConversation, 0)
	for rows.Next() {
		c, err := scanProjectAIConversation(rows)
		if err != nil {
			return nil, fmt.Errorf("scan project ai conversation: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetProjectAIConversation returns the conversation when it is that user's in that project,
// and ErrNotFound otherwise (missing, another user's and another project's are the same).
func (r MySQLRepository) GetProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) (ProjectAIConversation, error) {
	c, err := scanProjectAIConversation(r.DB.QueryRowContext(ctx, `SELECT `+projectAIConversationColumns+` FROM project_ai_conversations
 WHERE id=? AND project_id=? AND user_id=?`, conversationID, projectID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectAIConversation{}, ErrNotFound
	}
	if err != nil {
		return ProjectAIConversation{}, fmt.Errorf("get project ai conversation: %w", err)
	}
	return c, nil
}

// LatestProjectAIConversation returns the first conversation of the list, or nil when the
// user has none in the project.
func (r MySQLRepository) LatestProjectAIConversation(ctx context.Context, projectID, userID int64) (*ProjectAIConversation, error) {
	c, err := scanProjectAIConversation(r.DB.QueryRowContext(ctx, `SELECT `+projectAIConversationColumns+` FROM project_ai_conversations
 WHERE project_id=? AND user_id=?`+projectAIConversationOrder+` LIMIT 1`, projectID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest project ai conversation: %w", err)
	}
	return &c, nil
}

// DeleteProjectAIConversation deletes one conversation; its messages go with it (foreign key).
func (r MySQLRepository) DeleteProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) error {
	res, err := r.DB.ExecContext(ctx, `DELETE FROM project_ai_conversations WHERE id=? AND project_id=? AND user_id=?`, conversationID, projectID, userID)
	if err != nil {
		return fmt.Errorf("delete project ai conversation: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete project ai conversation: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

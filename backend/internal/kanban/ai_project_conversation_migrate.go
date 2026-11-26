package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (project_ai_conversations).
// updated_at has no ON UPDATE: AppendProjectAITurn writes it.
const projectAIConversationsDDL = `CREATE TABLE IF NOT EXISTS project_ai_conversations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_conversation_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_ai_conversation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX project_ai_conversations_scope (project_id, user_id, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// adoptProjectAIMessages puts the messages that are in no conversation (the single history
// from before the conversations, and what an older server wrote during a rollout) into one
// new conversation per project × user. With nothing to adopt it does nothing. The limit of
// maxProjectAIConversations is not applied here: the next new conversation applies it.
func adoptProjectAIMessages(ctx context.Context, conn *sql.Conn) error {
	scopes, err := projectAIScopesWithoutConversation(ctx, conn)
	if err != nil {
		return err
	}
	for _, s := range scopes {
		if err = adoptProjectAIMessagesOf(ctx, conn, s.projectID, s.userID); err != nil {
			return fmt.Errorf("adopt project ai messages (project %d, user %d): %w", s.projectID, s.userID, err)
		}
	}
	return nil
}

// projectAIScope is one project × user: the owner of a history.
type projectAIScope struct{ projectID, userID int64 }

// projectAIScopesWithoutConversation lists the owners that have a message in no conversation.
// The rows are read to the end before anything else runs: conn is a single connection.
func projectAIScopesWithoutConversation(ctx context.Context, conn *sql.Conn) ([]projectAIScope, error) {
	rows, err := conn.QueryContext(ctx, `SELECT DISTINCT project_id, user_id FROM project_ai_messages WHERE conversation_id IS NULL ORDER BY project_id, user_id`)
	if err != nil {
		return nil, fmt.Errorf("list project ai messages without a conversation: %w", err)
	}
	var scopes []projectAIScope
	for rows.Next() {
		var s projectAIScope
		if err = rows.Scan(&s.projectID, &s.userID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan project ai message scope: %w", err)
		}
		scopes = append(scopes, s)
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return scopes, nil
}

// adoptProjectAIMessagesOf handles one project × user. A serving instance may hold locks on
// the same rows (an older server appending or trimming), so a lost lock race (deadlock, lock
// wait timeout) is tried again instead of failing the start.
func adoptProjectAIMessagesOf(ctx context.Context, conn *sql.Conn, projectID, userID int64) error {
	return retryProjectAILockRace(ctx, func() error {
		return adoptProjectAIMessagesOfOnce(ctx, conn, projectID, userID)
	})
}

// adoptProjectAIMessagesOfOnce is one try, in one transaction: a failure leaves that scope as
// it was, for the next try or the next start. The conversation takes its title from the first
// user message and its times from the first and the last message; the messages keep their
// ids and times. When no message was adopted after all, the conversation is not kept.
func adoptProjectAIMessagesOfOnce(ctx context.Context, conn *sql.Conn, projectID, userID int64) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	title, err := adoptedProjectAIConversationTitle(ctx, tx, projectID, userID)
	if err != nil {
		return err
	}
	// The times are copied inside MySQL: they do not pass through the driver's time zone.
	res, err := tx.ExecContext(ctx, `INSERT INTO project_ai_conversations(project_id, user_id, title, created_at, updated_at)
 SELECT ?, ?, ?, MIN(created_at), MAX(created_at) FROM project_ai_messages
 WHERE project_id=? AND user_id=? AND conversation_id IS NULL HAVING COUNT(*) > 0`, projectID, userID, title, projectID, userID)
	if err != nil {
		return fmt.Errorf("create conversation: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err // nothing left to adopt: the deferred rollback ends the transaction
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	res, err = tx.ExecContext(ctx, `UPDATE project_ai_messages SET conversation_id=? WHERE project_id=? AND user_id=? AND conversation_id IS NULL`, id, projectID, userID)
	if err != nil {
		return fmt.Errorf("set conversation: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err // adopted by someone else meanwhile: roll back, no empty conversation stays
	}
	return tx.Commit()
}

// adoptedProjectAIConversationTitle names the conversation the scope's messages are adopted
// into: from their first user message, or projectAIConversationTitleAdopted without one.
func adoptedProjectAIConversationTitle(ctx context.Context, tx *sql.Tx, projectID, userID int64) (string, error) {
	var first string
	err := tx.QueryRowContext(ctx, `SELECT body FROM project_ai_messages
 WHERE project_id=? AND user_id=? AND conversation_id IS NULL AND role=? ORDER BY created_at ASC, id ASC LIMIT 1`, projectID, userID, AIRoleUser).Scan(&first)
	switch {
	case err == nil:
		return projectAIConversationTitle(first), nil
	case errors.Is(err, sql.ErrNoRows):
		return projectAIConversationTitleAdopted, nil
	}
	return "", fmt.Errorf("first user message: %w", err)
}

// deleteEmptyProjectAIConversations removes the conversations that have no message. This
// server stores a conversation and its first messages in one transaction, so an empty one
// only comes from an older server clearing the history (it deletes the messages only).
//
// The DELETE waits for a conversation a serving instance is storing right now (its row is
// locked until that transaction ends) and then sees the messages stored with it, so it does
// not remove it. A lost lock race there (deadlock, lock wait timeout) is tried again instead
// of failing the start.
func deleteEmptyProjectAIConversations(ctx context.Context, conn *sql.Conn) error {
	err := retryProjectAILockRace(ctx, func() error {
		_, err := conn.ExecContext(ctx, `DELETE FROM project_ai_conversations
 WHERE NOT EXISTS (SELECT 1 FROM project_ai_messages m WHERE m.conversation_id = project_ai_conversations.id)`)
		return err
	})
	if err != nil {
		return fmt.Errorf("delete empty project ai conversations: %w", err)
	}
	return nil
}

package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// projectAITurnMessages is how many messages one exchange adds: the user's and the answer.
const projectAITurnMessages = 2

// ProjectAITurn is one exchange to store: the user's message, the final answer and the tokens
// the model reported for it (0: not reported). Title names the conversation when the exchange
// starts a new one; it is not used otherwise.
type ProjectAITurn struct {
	Title         string
	UserBody      string
	AssistantBody string
	InputTokens   int64
	OutputTokens  int64
	// Proposals are stored with the answer, in the same transaction.
	Proposals []ProjectAIProposalDraft
}

// AppendProjectAITurn stores one exchange (the user's message and the final answer) in one
// transaction and returns the conversation it went to: the named one, or a new one named
// turn.Title when conversationID is nil or that conversation is gone (deleted while the model
// was working). A lost lock race is tried again (retryProjectAILockRace). See
// appendProjectAITurnOnce for the steps.
func (r MySQLRepository) AppendProjectAITurn(ctx context.Context, projectID, userID int64, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error) {
	var conversation ProjectAIConversation
	err := retryProjectAILockRace(ctx, func() (err error) {
		conversation, err = r.appendProjectAITurnOnce(ctx, projectID, userID, conversationID, turn)
		return err
	})
	return conversation, err
}

// appendProjectAITurnOnce is one try, in one transaction: lock the named conversation (or make
// a new one and trim the conversations), trim its messages, add the two new ones, touch it.
func (r MySQLRepository) appendProjectAITurnOnce(ctx context.Context, projectID, userID int64, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return ProjectAIConversation{}, err
	}
	defer tx.Rollback()
	// The conversation's row is locked first. While it is held, deleting that conversation
	// waits (so it cannot vanish between this check and the INSERTs, which would break the
	// foreign key), and two appends to one conversation run one after the other.
	id, found, err := lockProjectAIConversation(ctx, tx, projectID, userID, conversationID)
	if err != nil {
		return ProjectAIConversation{}, err
	}
	if !found {
		if id, err = createProjectAIConversation(ctx, tx, projectID, userID, turn.Title); err != nil {
			return ProjectAIConversation{}, err
		}
		if err = trimProjectAIConversations(ctx, tx, projectID, userID, id); err != nil {
			return ProjectAIConversation{}, err
		}
	}
	if err = trimProjectAIMessages(ctx, tx, id, projectAITurnMessages); err != nil {
		return ProjectAIConversation{}, err
	}
	if err = insertProjectAITurnMessages(ctx, tx, projectID, userID, id, turn); err != nil {
		return ProjectAIConversation{}, err
	}
	conversation, err := touchProjectAIConversation(ctx, tx, id)
	if err != nil {
		return ProjectAIConversation{}, err
	}
	if err = tx.Commit(); err != nil {
		return ProjectAIConversation{}, fmt.Errorf("append project ai turn: %w", err)
	}
	return conversation, nil
}

// insertProjectAITurnMessages adds the user's message and the answer to the conversation. The
// owner is written on the messages with the same values the conversation's row was found (or
// made) with: the two places cannot disagree. A token count that was not reported is NULL
// (tokenCountPtr).
func insertProjectAITurnMessages(ctx context.Context, tx *sql.Tx, projectID, userID, conversationID int64, turn ProjectAITurn) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, conversation_id, role, body) VALUES (?,?,?,?,?)`,
		projectID, userID, conversationID, AIRoleUser, turn.UserBody); err != nil {
		return fmt.Errorf("append user project ai message: %w", err)
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO project_ai_messages(project_id, user_id, conversation_id, role, body, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?)`,
		projectID, userID, conversationID, AIRoleAssistant, turn.AssistantBody, tokenCountPtr(turn.InputTokens), tokenCountPtr(turn.OutputTokens))
	if err != nil {
		return fmt.Errorf("append assistant project ai message: %w", err)
	}
	if len(turn.Proposals) == 0 {
		return nil
	}
	assistantID, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("append assistant project ai message: %w", err)
	}
	return insertProjectAIProposals(ctx, tx, projectID, userID, assistantID, turn.Proposals)
}

// touchProjectAIConversation sets updated_at to now and returns the conversation as stored.
// The application writes updated_at (no ON UPDATE): it is the time of the last exchange, on
// the same clock as the messages' created_at, and it orders the list. It narrows by the
// conversation's id alone: conversationID is one whose owner lockProjectAIConversation checked
// in this transaction, or one this transaction just made.
func touchProjectAIConversation(ctx context.Context, tx *sql.Tx, conversationID int64) (ProjectAIConversation, error) {
	if _, err := tx.ExecContext(ctx, `UPDATE project_ai_conversations SET updated_at=CURRENT_TIMESTAMP(6) WHERE id=?`, conversationID); err != nil {
		return ProjectAIConversation{}, fmt.Errorf("touch project ai conversation: %w", err)
	}
	conversation, err := scanProjectAIConversation(tx.QueryRowContext(ctx, `SELECT `+projectAIConversationColumns+` FROM project_ai_conversations WHERE id=?`, conversationID))
	if err != nil {
		return ProjectAIConversation{}, fmt.Errorf("read stored project ai conversation: %w", err)
	}
	return conversation, nil
}

// lockProjectAIConversation locks the row of the named conversation when it is that user's in
// that project. found is false when no conversation was named or it is not there (any more).
func lockProjectAIConversation(ctx context.Context, tx *sql.Tx, projectID, userID int64, conversationID *int64) (id int64, found bool, err error) {
	if conversationID == nil {
		return 0, false, nil
	}
	err = tx.QueryRowContext(ctx, `SELECT id FROM project_ai_conversations WHERE id=? AND project_id=? AND user_id=? FOR UPDATE`,
		*conversationID, projectID, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("lock project ai conversation: %w", err)
	}
	return id, true, nil
}

// createProjectAIConversation adds a conversation named title and returns its id.
func createProjectAIConversation(ctx context.Context, tx *sql.Tx, projectID, userID int64, title string) (int64, error) {
	res, err := tx.ExecContext(ctx, `INSERT INTO project_ai_conversations(project_id, user_id, title) VALUES (?,?,?)`, projectID, userID, title)
	if err != nil {
		return 0, fmt.Errorf("create project ai conversation: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create project ai conversation: %w", err)
	}
	return id, nil
}

// trimProjectAIConversations keeps the user's maxProjectAIConversations most recently updated
// conversations in the project: every one beyond that is deleted, oldest update first, never
// the one named keepID (the one just made).
func trimProjectAIConversations(ctx context.Context, tx *sql.Tx, projectID, userID, keepID int64) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_ai_conversations WHERE project_id=? AND user_id=?`, projectID, userID).Scan(&count); err != nil {
		return fmt.Errorf("count project ai conversations: %w", err)
	}
	if overflow := projectAIConversationsOverLimit(count); overflow > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM project_ai_conversations WHERE project_id=? AND user_id=? AND id<>? ORDER BY updated_at ASC, id ASC LIMIT ?`,
			projectID, userID, keepID, overflow); err != nil {
			return fmt.Errorf("trim project ai conversations: %w", err)
		}
	}
	return nil
}

// trimProjectAIMessages drops the oldest messages of the conversation so that it holds at most
// maxAIChatStoredMessages once adding more are stored. It narrows by the conversation's id
// alone: conversationID is one whose owner lockProjectAIConversation checked in this
// transaction, or one this transaction just made.
func trimProjectAIMessages(ctx context.Context, tx *sql.Tx, conversationID int64, adding int) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_ai_messages WHERE conversation_id=?`, conversationID).Scan(&count); err != nil {
		return fmt.Errorf("count project ai messages: %w", err)
	}
	if overflow := projectAIMessagesOverLimit(count, adding); overflow > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM project_ai_messages WHERE conversation_id=? ORDER BY created_at ASC, id ASC LIMIT ?`, conversationID, overflow); err != nil {
			return fmt.Errorf("trim project ai messages: %w", err)
		}
	}
	return nil
}

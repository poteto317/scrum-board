package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (project_ai_proposals).
// The only foreign key is the message: deleting the message (trimming, deleting the
// conversation, clearing, also by an older server that does not know this table) deletes its
// proposals. project_id and user_id repeat the message's owner so that every read and write
// narrows by the owner without a join.
const projectAIProposalsDDL = `CREATE TABLE IF NOT EXISTS project_ai_proposals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  item_number BIGINT NULL,
  item_title VARCHAR(200) NULL,
  column_id BIGINT NULL,
  column_name VARCHAR(60) NULL,
  title VARCHAR(200) NULL,
  description TEXT NULL,
  base_description TEXT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_item_number BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_proposal_message FOREIGN KEY (message_id) REFERENCES project_ai_messages(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_ai_proposal_kind CHECK (kind IN ('status_change', 'description_edit', 'item_create')),
  CONSTRAINT chk_project_ai_proposal_state CHECK (state IN ('pending', 'applied', 'dismissed')),
  INDEX project_ai_proposals_message (message_id, id),
  INDEX project_ai_proposals_scope (project_id, user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

const projectAIProposalColumns = `p.id, p.message_id, p.kind, p.state, p.item_number, p.item_title, p.column_id, p.column_name,
 p.title, p.description, p.base_description, p.created_item_number, p.created_at, p.updated_at`

func scanProjectAIProposal(row scanner) (ProjectAIProposal, error) {
	var (
		p                                                      ProjectAIProposal
		itemNumber, columnID, createdItemNumber                sql.NullInt64
		itemTitle, columnName, title, description, baseDescrip sql.NullString
	)
	if err := row.Scan(&p.ID, &p.MessageID, &p.Kind, &p.State, &itemNumber, &itemTitle, &columnID, &columnName,
		&title, &description, &baseDescrip, &createdItemNumber, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return ProjectAIProposal{}, err
	}
	p.ItemNumber = nullInt64Ptr(itemNumber)
	p.ColumnID = nullInt64Ptr(columnID)
	p.CreatedItemNumber = nullInt64Ptr(createdItemNumber)
	p.ItemTitle = nullStringPtr(itemTitle)
	p.ColumnName = nullStringPtr(columnName)
	p.Title = nullStringPtr(title)
	p.Description = nullStringPtr(description)
	p.BaseDescription = nullStringPtr(baseDescrip)
	return p, nil
}

func nullInt64Ptr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func nullStringPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

// insertProjectAIProposals stores the proposals of one answer, in the transaction that stores
// the answer (messageID), with the same owner.
func insertProjectAIProposals(ctx context.Context, tx *sql.Tx, projectID, userID, messageID int64, drafts []ProjectAIProposalDraft) error {
	for _, d := range drafts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_ai_proposals(message_id, project_id, user_id, kind, item_number, item_title,
 column_id, column_name, title, description, base_description) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			messageID, projectID, userID, d.Kind, d.ItemNumber, d.ItemTitle, d.ColumnID, d.ColumnName, d.Title, d.Description, d.BaseDescription); err != nil {
			return fmt.Errorf("append project ai proposal: %w", err)
		}
	}
	return nil
}

// attachProjectAIProposals puts the stored proposals of the conversation on their messages.
// The owner narrows the read like it narrows the messages.
func (r MySQLRepository) attachProjectAIProposals(ctx context.Context, projectID, userID, conversationID int64, messages []ProjectAIMessage) error {
	if len(messages) == 0 {
		return nil
	}
	rows, err := r.DB.QueryContext(ctx, `SELECT `+projectAIProposalColumns+` FROM project_ai_proposals p
 JOIN project_ai_messages m ON m.id = p.message_id
 WHERE m.conversation_id=? AND p.project_id=? AND p.user_id=? ORDER BY p.id`, conversationID, projectID, userID)
	if err != nil {
		return fmt.Errorf("list project ai proposals: %w", err)
	}
	defer rows.Close()
	byMessage := map[int64][]ProjectAIProposal{}
	for rows.Next() {
		p, err := scanProjectAIProposal(rows)
		if err != nil {
			return fmt.Errorf("scan project ai proposal: %w", err)
		}
		byMessage[p.MessageID] = append(byMessage[p.MessageID], p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	attachProposalsToMessages(messages, byMessage)
	return nil
}

// attachProposalsToMessages sets each message's proposals from byMessage (by message id).
func attachProposalsToMessages(messages []ProjectAIMessage, byMessage map[int64][]ProjectAIProposal) {
	for i := range messages {
		if list := byMessage[messages[i].ID]; len(list) > 0 {
			messages[i].Proposals = list
		}
	}
}

// UpdateProjectAIProposal changes the state of one of the user's proposals in the project, in
// one transaction: the row is locked, the change is checked against the current state
// (proposalTransitionAllowed), then written. A proposal that is not there, or is another user's
// or another project's, is ErrNotFound. A change the current state does not allow returns the
// current proposal and ErrProposalConflict (so a second claim loses).
func (r MySQLRepository) UpdateProjectAIProposal(ctx context.Context, projectID, userID, proposalID int64, change ProjectAIProposalChange) (ProjectAIProposal, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return ProjectAIProposal{}, err
	}
	defer tx.Rollback()
	current, err := scanProjectAIProposal(tx.QueryRowContext(ctx, `SELECT `+projectAIProposalColumns+` FROM project_ai_proposals p
 WHERE p.id=? AND p.project_id=? AND p.user_id=? FOR UPDATE`, proposalID, projectID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectAIProposal{}, ErrNotFound
	}
	if err != nil {
		return ProjectAIProposal{}, fmt.Errorf("lock project ai proposal: %w", err)
	}
	if !proposalTransitionAllowed(current, change) {
		return current, ErrProposalConflict
	}
	if _, err = tx.ExecContext(ctx, `UPDATE project_ai_proposals SET state=?, created_item_number=COALESCE(?, created_item_number),
 updated_at=CURRENT_TIMESTAMP(6) WHERE id=?`, change.State, change.CreatedItemNumber, current.ID); err != nil {
		return ProjectAIProposal{}, fmt.Errorf("update project ai proposal: %w", err)
	}
	updated, err := scanProjectAIProposal(tx.QueryRowContext(ctx, `SELECT `+projectAIProposalColumns+` FROM project_ai_proposals p WHERE p.id=?`, current.ID))
	if err != nil {
		return ProjectAIProposal{}, fmt.Errorf("read project ai proposal: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return ProjectAIProposal{}, fmt.Errorf("update project ai proposal: %w", err)
	}
	return updated, nil
}

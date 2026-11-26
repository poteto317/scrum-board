package kanban

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"
)

// Keep in sync with database/init/001_schema.sql (project_ai_messages).
// conversation_id is the last column, and its index comes before its foreign key, so that a
// table made by this statement and an older one upgraded by migrateProjectAIMessages have the
// same shape.
const projectAIMessagesDDL = `CREATE TABLE IF NOT EXISTS project_ai_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL,
  body TEXT NOT NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  conversation_id BIGINT NULL,
  CONSTRAINT fk_project_ai_message_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_ai_message_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_ai_message_role CHECK (role IN ('user', 'assistant')),
  INDEX project_ai_messages_scope (project_id, user_id, created_at, id),
  INDEX project_ai_messages_conversation (conversation_id, created_at, id),
  CONSTRAINT fk_project_ai_message_conversation FOREIGN KEY (conversation_id) REFERENCES project_ai_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

const (
	// projectAIChatMigrateLock serializes InitializeProjectAIChat across the instances that
	// may start at the same time.
	projectAIChatMigrateLock = "scrumboard_project_ai_conversations_migrate"
	// projectAIChatMigrateLockSeconds is how long a start waits for another one's migration.
	projectAIChatMigrateLockSeconds = 30
	// projectAIChatUnlockTimeout limits giving the lock back, also when ctx is already over.
	projectAIChatUnlockTimeout = 5 * time.Second
)

// InitializeProjectAIChat creates and upgrades project_ai_conversations and project_ai_messages
// and puts every message in a conversation (idempotent, runs at every start).
// The tables reference users, so this must run after InitializeUsers
// (InitializeAIChat runs before it and cannot create them).
//
// Everything runs on one connection, between GET_LOCK and RELEASE_LOCK: a named lock belongs
// to its connection, so taking and releasing it through the pool would not exclude anything.
func (r MySQLRepository) InitializeProjectAIChat(ctx context.Context) error {
	return r.initializeProjectAIChat(ctx, projectAIChatMigrateLockSeconds)
}

// initializeProjectAIChat is InitializeProjectAIChat with the wait for the lock given, so that
// a test can let it run out. Without the lock nothing is touched.
func (r MySQLRepository) initializeProjectAIChat(ctx context.Context, lockWaitSeconds int) error {
	conn, err := r.DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("project ai chat migrate connection: %w", err)
	}
	defer conn.Close()
	if err = acquireProjectAIChatMigrateLock(ctx, conn, lockWaitSeconds); err != nil {
		return err
	}
	defer releaseProjectAIChatMigrateLock(ctx, conn)

	// 1. + 2. the tables (the conversations first: the messages reference them).
	if _, err = conn.ExecContext(ctx, projectAIConversationsDDL); err != nil {
		return fmt.Errorf("create project_ai_conversations: %w", err)
	}
	if _, err = conn.ExecContext(ctx, projectAIMessagesDDL); err != nil {
		return fmt.Errorf("create project_ai_messages: %w", err)
	}
	// 3. – 5. a table from before the conversations gets the column, the index and the foreign key.
	if err = migrateProjectAIMessages(ctx, conn); err != nil {
		return err
	}
	// 6. messages without a conversation become one conversation per project × user.
	if err = adoptProjectAIMessages(ctx, conn); err != nil {
		return err
	}
	// 7. conversations without a message are removed.
	return deleteEmptyProjectAIConversations(ctx, conn)
}

// errProjectAIChatMigrateLockBusy: another connection still held the lock when the wait ended.
var errProjectAIChatMigrateLockBusy = errors.New("project ai chat migrate lock busy")

// acquireProjectAIChatMigrateLock takes the lock on conn, waiting up to waitSeconds for another
// start that holds it. When the wait runs out (GET_LOCK answers 0) or MySQL cannot tell (NULL),
// it fails with errProjectAIChatMigrateLockBusy.
func acquireProjectAIChatMigrateLock(ctx context.Context, conn *sql.Conn, waitSeconds int) error {
	var locked sql.NullInt64
	if err := conn.QueryRowContext(ctx, `SELECT GET_LOCK(?, ?)`, projectAIChatMigrateLock, waitSeconds).Scan(&locked); err != nil {
		return fmt.Errorf("project ai chat migrate lock: %w", err)
	}
	if !locked.Valid || locked.Int64 != 1 {
		return errProjectAIChatMigrateLockBusy
	}
	return nil
}

// releaseProjectAIChatMigrateLock gives the lock back on its connection. When that fails the
// connection is discarded instead of going back to the pool with the lock still held.
func releaseProjectAIChatMigrateLock(ctx context.Context, conn *sql.Conn) {
	unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), projectAIChatUnlockTimeout)
	defer cancel()
	if _, err := conn.ExecContext(unlockCtx, `DO RELEASE_LOCK(?)`, projectAIChatMigrateLock); err != nil {
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
}

// migrateProjectAIMessages adds what projectAIMessagesDDL has and an older table lacks. Each
// part is looked up in information_schema first and left alone when it is there. The index is
// added before the foreign key, so MySQL does not make another index for the key.
func migrateProjectAIMessages(ctx context.Context, conn *sql.Conn) error {
	parts := []struct {
		name, exists, add string
	}{
		{"project_ai_messages.conversation_id",
			`SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_ai_messages' AND COLUMN_NAME = 'conversation_id'`,
			`ALTER TABLE project_ai_messages ADD COLUMN conversation_id BIGINT NULL`},
		{"project_ai_messages_conversation",
			`SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_ai_messages' AND INDEX_NAME = 'project_ai_messages_conversation'`,
			`ALTER TABLE project_ai_messages ADD INDEX project_ai_messages_conversation (conversation_id, created_at, id)`},
		{"fk_project_ai_message_conversation",
			`SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_ai_messages' AND CONSTRAINT_NAME = 'fk_project_ai_message_conversation'`,
			`ALTER TABLE project_ai_messages
  ADD CONSTRAINT fk_project_ai_message_conversation FOREIGN KEY (conversation_id) REFERENCES project_ai_conversations(id) ON DELETE CASCADE`},
	}
	for _, part := range parts {
		var count int
		if err := conn.QueryRowContext(ctx, part.exists).Scan(&count); err != nil {
			return fmt.Errorf("check %s: %w", part.name, err)
		}
		if count > 0 {
			continue
		}
		if _, err := conn.ExecContext(ctx, part.add); err != nil {
			return fmt.Errorf("add %s: %w", part.name, err)
		}
	}
	return nil
}

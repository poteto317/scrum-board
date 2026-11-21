package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (users).
const usersDDL = `CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login_name VARCHAR(80) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(16) NOT NULL,
  disabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_users_login_name (login_name),
  CONSTRAINT chk_users_role CHECK (role IN ('admin', 'member'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// Keep in sync with database/init/001_schema.sql (sessions).
const sessionsDDL = `CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX sessions_user_id (user_id),
  INDEX sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeUsers creates the users table when missing (idempotent).
func (r MySQLRepository) InitializeUsers(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, usersDDL); err != nil {
		return fmt.Errorf("create users: %w", err)
	}
	return nil
}

// InitializeSessions creates the sessions table when missing (idempotent).
func (r MySQLRepository) InitializeSessions(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, sessionsDDL); err != nil {
		return fmt.Errorf("create sessions: %w", err)
	}
	return nil
}

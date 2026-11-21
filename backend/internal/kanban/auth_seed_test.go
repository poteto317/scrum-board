package kanban

import (
	"context"
	"time"
)

// seedHandlerTestAuth inserts the shared handler-test admin + session into MySQL.
func seedHandlerTestAuth(ctx context.Context, r MySQLRepository) error {
	hash, err := HashPassword("test-password")
	if err != nil {
		return err
	}
	res, err := r.DB.ExecContext(ctx, `
INSERT INTO users (login_name, display_name, password_hash, role, disabled)
VALUES ('admin', 'admin', ?, 'admin', 0)`, hash)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	exp := time.Now().UTC().Add(24 * time.Hour)
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, HandlerTestSessionID, id, exp)
	return err
}

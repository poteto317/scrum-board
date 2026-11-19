package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (item ACL columns + item_acl_entries).
const itemACLEntriesDDL = `CREATE TABLE IF NOT EXISTS item_acl_entries (
  item_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  capability VARCHAR(8) NOT NULL,
  PRIMARY KEY (item_id, user_id, capability),
  CONSTRAINT fk_item_acl_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_acl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_item_acl_capability CHECK (capability IN ('view', 'edit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeItemACL adds view/edit access columns, created_by, and item_acl_entries.
func (r MySQLRepository) InitializeItemACL(ctx context.Context) error {
	type col struct {
		name string
		ddl  string
	}
	for _, c := range []col{
		{"view_access", "ALTER TABLE items ADD COLUMN view_access VARCHAR(16) NOT NULL DEFAULT 'open'"},
		{"edit_access", "ALTER TABLE items ADD COLUMN edit_access VARCHAR(16) NOT NULL DEFAULT 'open'"},
		{"created_by_user_id", "ALTER TABLE items ADD COLUMN created_by_user_id BIGINT NULL"},
	} {
		ok, err := r.columnExists(ctx, "items", c.name)
		if err != nil {
			return fmt.Errorf("check items.%s: %w", c.name, err)
		}
		if ok {
			continue
		}
		if _, err = r.DB.ExecContext(ctx, c.ddl); err != nil {
			return fmt.Errorf("add items.%s: %w", c.name, err)
		}
	}
	// FK after column exists (users table required by InitializeUsers first).
	var fkCount int
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND CONSTRAINT_NAME = 'fk_items_created_by'`).Scan(&fkCount)
	if err != nil {
		return fmt.Errorf("check fk_items_created_by: %w", err)
	}
	if fkCount == 0 {
		if _, err = r.DB.ExecContext(ctx, `
ALTER TABLE items
  ADD CONSTRAINT fk_items_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL`); err != nil {
			return fmt.Errorf("add fk_items_created_by: %w", err)
		}
	}
	if _, err := r.DB.ExecContext(ctx, itemACLEntriesDDL); err != nil {
		return fmt.Errorf("create item_acl_entries: %w", err)
	}
	return nil
}

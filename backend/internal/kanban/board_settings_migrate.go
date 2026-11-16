package kanban

import (
	"context"
	"fmt"
)

// InitializeBoardSettings creates board_settings when missing and ensures card_layout=pack exists.
func (r MySQLRepository) InitializeBoardSettings(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS board_settings (
 setting_key VARCHAR(64) PRIMARY KEY,
 setting_value VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create board_settings: %w", err)
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value)
SELECT 'card_layout', ?
 WHERE NOT EXISTS (
  SELECT 1 FROM board_settings WHERE setting_key='card_layout'
)`, CardLayoutPack)
	if err != nil {
		return fmt.Errorf("seed board_settings.card_layout: %w", err)
	}
	return nil
}

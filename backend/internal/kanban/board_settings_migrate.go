package kanban

import (
	"context"
	"fmt"
)

// InitializeBoardSettings creates board_settings when missing and ensures card_layout=pack
// and mobile_board_column_id (when columns exist) are seeded.
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
SELECT ?, ?
 WHERE NOT EXISTS (
  SELECT 1 FROM board_settings WHERE setting_key=?
)`, settingKeyCardLayout, CardLayoutPack, settingKeyCardLayout)
	if err != nil {
		return fmt.Errorf("seed board_settings.card_layout: %w", err)
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	columns, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return err
	}
	if err = seedMobileBoardColumnID(ctx, tx, columns); err != nil {
		return err
	}
	return tx.Commit()
}

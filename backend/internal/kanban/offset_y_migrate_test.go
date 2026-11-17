package kanban

import (
	"context"
	"testing"
)

func TestInitializeItemOffsetYIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	// Schema already has offset_y; dropping it simulates a legacy board.
	mustExec(t, db, `ALTER TABLE items DROP COLUMN offset_y`)
	if err := r.InitializeItemOffsetY(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='offset_y'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("offset_y missing: count=%d err=%v", count, err)
	}
	var offset int
	if err := db.QueryRow(`SELECT offset_y FROM items LIMIT 1`).Scan(&offset); err != nil {
		t.Fatal(err)
	}
	if offset != 0 {
		t.Fatalf("existing rows want offset_y=0, got %d", offset)
	}
	if err := r.InitializeItemOffsetY(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestInitializeBoardSettingsIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `DROP TABLE board_settings`)
	if err := r.InitializeBoardSettings(ctx); err != nil {
		t.Fatal(err)
	}
	var value string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='card_layout'`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != CardLayoutPack {
		t.Fatalf("card_layout=%q", value)
	}
	mustExec(t, db, `INSERT INTO board_settings(setting_key, setting_value) VALUES('theme','dark')
 ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`)
	mustExec(t, db, `UPDATE board_settings SET setting_value='free' WHERE setting_key='card_layout'`)
	if err := r.InitializeBoardSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='card_layout'`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != CardLayoutFree {
		t.Fatalf("re-run must not overwrite card_layout: %q", value)
	}
	var theme string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='theme'`).Scan(&theme); err != nil || theme != "dark" {
		t.Fatalf("unknown key must be kept: %q err=%v", theme, err)
	}
	var mobile string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='mobile_board_column_id'`).Scan(&mobile); err != nil {
		t.Fatalf("mobile_board_column_id seed: %v", err)
	}
	if mobile == "" || mobile == "0" {
		t.Fatalf("mobile_board_column_id=%q", mobile)
	}
	mustExec(t, db, `UPDATE board_settings SET setting_value='999' WHERE setting_key='mobile_board_column_id'`)
	if err := r.InitializeBoardSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='mobile_board_column_id'`).Scan(&mobile); err != nil {
		t.Fatal(err)
	}
	if mobile != "999" {
		t.Fatalf("re-run must not overwrite mobile_board_column_id: %q", mobile)
	}
}

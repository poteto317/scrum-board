package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
)

const (
	settingKeyCardLayout          = "card_layout"
	settingKeyMobileBoardColumnID = "mobile_board_column_id"
	settingKeyActiveProjectID     = "active_project_id"
)

func normalizeCardLayout(v string) string {
	if v == CardLayoutFree {
		return CardLayoutFree
	}
	return CardLayoutPack
}

func fallbackMobileColumnID(columns []Column) int64 {
	for _, c := range columns {
		if c.Name == "Todo" {
			return c.ID
		}
	}
	if len(columns) == 0 {
		return 0
	}
	best := columns[0]
	for _, c := range columns[1:] {
		if c.Position < best.Position || (c.Position == best.Position && c.ID < best.ID) {
			best = c
		}
	}
	return best.ID
}

func resolveMobileBoardColumnID(saved int64, columns []Column) int64 {
	if saved > 0 {
		for _, c := range columns {
			if c.ID == saved {
				return saved
			}
		}
	}
	return fallbackMobileColumnID(columns)
}

func columnIDExists(columns []Column, id int64) bool {
	for _, c := range columns {
		if c.ID == id {
			return true
		}
	}
	return false
}

// BoardSettingsPatch is the PATCH body (pointers = omitted).
type BoardSettingsPatch struct {
	CardLayout          *string `json:"cardLayout"`
	MobileBoardColumnID *int64  `json:"mobileBoardColumnId"`
	ActiveProjectID     *int64  `json:"activeProjectId"`
}

// applyBoardSettingsPatch merges a partial patch onto current (raw) settings.
// At least one of the three keys is required. Invalid cardLayout values must be
// rejected by the caller before calling. activeProjectId must be a positive id
// that exists in projects. Omitted keys stay at their raw values (L-841).
func applyBoardSettingsPatch(current BoardSettings, columns []Column, projects []Project, in BoardSettingsPatch) (BoardSettings, error) {
	if in.CardLayout == nil && in.MobileBoardColumnID == nil && in.ActiveProjectID == nil {
		return BoardSettings{}, ErrBoardSettings
	}
	next := current
	if in.CardLayout != nil {
		next.CardLayout = *in.CardLayout
	}
	if in.MobileBoardColumnID != nil {
		id := *in.MobileBoardColumnID
		if id <= 0 || !columnIDExists(columns, id) {
			return BoardSettings{}, ErrBoardSettings
		}
		next.MobileBoardColumnID = id
	}
	if in.ActiveProjectID != nil {
		id := *in.ActiveProjectID
		if id <= 0 || !projectIDExists(projects, id) {
			return BoardSettings{}, ErrBoardSettings
		}
		next.ActiveProjectID = id
	}
	return next, nil
}

func loadBoardSettings(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (BoardSettings, error) {
	settings := BoardSettings{CardLayout: CardLayoutPack, MobileBoardColumnID: 0}
	var layout string
	err := q.QueryRowContext(ctx, "SELECT setting_value FROM board_settings WHERE setting_key=?", settingKeyCardLayout).Scan(&layout)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return BoardSettings{}, err
	}
	if err == nil {
		settings.CardLayout = normalizeCardLayout(layout)
	}
	var mobile string
	err = q.QueryRowContext(ctx, "SELECT setting_value FROM board_settings WHERE setting_key=?", settingKeyMobileBoardColumnID).Scan(&mobile)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return BoardSettings{}, err
	}
	if err == nil {
		if id, parseErr := strconv.ParseInt(mobile, 10, 64); parseErr == nil {
			settings.MobileBoardColumnID = id
		}
	}
	var active string
	err = q.QueryRowContext(ctx, "SELECT setting_value FROM board_settings WHERE setting_key=?", settingKeyActiveProjectID).Scan(&active)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return BoardSettings{}, err
	}
	if err == nil {
		if id, parseErr := strconv.ParseInt(active, 10, 64); parseErr == nil {
			settings.ActiveProjectID = id
		}
	}
	return settings, nil
}

func (r MySQLRepository) PatchBoardSettings(ctx context.Context, patch BoardSettingsPatch) (BoardSettings, []Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	defer tx.Rollback()

	if _, err = lockColumnRows(ctx, tx); err != nil {
		return BoardSettings{}, nil, err
	}
	columns, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	current, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	next, err := applyBoardSettingsPatch(current, columns, projects, patch)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	if patch.CardLayout != nil {
		if *patch.CardLayout != CardLayoutPack && *patch.CardLayout != CardLayoutFree {
			return BoardSettings{}, nil, ErrBoardSettings
		}
		if _, err = tx.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value) VALUES(?, ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, settingKeyCardLayout, next.CardLayout); err != nil {
			return BoardSettings{}, nil, err
		}
	}
	if patch.MobileBoardColumnID != nil {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value) VALUES(?, ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, settingKeyMobileBoardColumnID, strconv.FormatInt(next.MobileBoardColumnID, 10)); err != nil {
			return BoardSettings{}, nil, err
		}
	}
	if patch.ActiveProjectID != nil {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value) VALUES(?, ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, settingKeyActiveProjectID, strconv.FormatInt(next.ActiveProjectID, 10)); err != nil {
			return BoardSettings{}, nil, err
		}
	}
	settings := BoardSettings{
		CardLayout:          next.CardLayout,
		MobileBoardColumnID: resolveMobileBoardColumnID(next.MobileBoardColumnID, columns),
		ActiveProjectID:     resolveActiveProjectID(next.ActiveProjectID, projects),
	}
	transitionToPack := current.CardLayout == CardLayoutFree && next.CardLayout == CardLayoutPack
	if !transitionToPack {
		return settings, nil, tx.Commit()
	}
	if err = reassignPositionsByOffsetY(ctx, tx); err != nil {
		return BoardSettings{}, nil, err
	}
	cards, err := listOrderedCards(ctx, tx, settings.ActiveProjectID)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	if err = tx.Commit(); err != nil {
		return BoardSettings{}, nil, err
	}
	return settings, cards, nil
}

// UpdateBoardSettings writes a full settings snapshot (integration / legacy). MobileBoardColumnID==0 keeps the mobile row.
func (r MySQLRepository) UpdateBoardSettings(ctx context.Context, in BoardSettings) (BoardSettings, []Item, error) {
	patch := BoardSettingsPatch{CardLayout: &in.CardLayout}
	if in.MobileBoardColumnID > 0 {
		id := in.MobileBoardColumnID
		patch.MobileBoardColumnID = &id
	}
	if in.ActiveProjectID > 0 {
		id := in.ActiveProjectID
		patch.ActiveProjectID = &id
	}
	return r.PatchBoardSettings(ctx, patch)
}

func seedMobileBoardColumnID(ctx context.Context, tx *sql.Tx, columns []Column) error {
	if len(columns) == 0 {
		return nil
	}
	id := fallbackMobileColumnID(columns)
	if id <= 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value)
SELECT ?, ?
 WHERE NOT EXISTS (
  SELECT 1 FROM board_settings WHERE setting_key=?
)`, settingKeyMobileBoardColumnID, strconv.FormatInt(id, 10), settingKeyMobileBoardColumnID)
	if err != nil {
		return fmt.Errorf("seed board_settings.mobile_board_column_id: %w", err)
	}
	return nil
}

// seedActiveProjectID inserts the first project's id when the row is missing.
// An existing row, including an invalid id, is left unchanged (L-841).
func seedActiveProjectID(ctx context.Context, db *sql.DB) error {
	var n int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM board_settings WHERE setting_key=?`, settingKeyActiveProjectID).Scan(&n); err != nil {
		return fmt.Errorf("check board_settings.active_project_id: %w", err)
	}
	if n > 0 {
		return nil
	}
	var id int64
	err := db.QueryRowContext(ctx, `SELECT id FROM projects ORDER BY position, id LIMIT 1`).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("seed board_settings.active_project_id: %w", err)
	}
	_, err = db.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value)
SELECT ?, ?
 WHERE NOT EXISTS (
  SELECT 1 FROM board_settings WHERE setting_key=?
)`, settingKeyActiveProjectID, strconv.FormatInt(id, 10), settingKeyActiveProjectID)
	if err != nil {
		return fmt.Errorf("seed board_settings.active_project_id: %w", err)
	}
	return nil
}

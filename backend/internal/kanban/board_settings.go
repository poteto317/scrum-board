package kanban

import (
	"context"
	"database/sql"
	"errors"
)

func normalizeCardLayout(v string) string {
	if v == CardLayoutFree {
		return CardLayoutFree
	}
	return CardLayoutPack
}

func loadBoardSettings(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (BoardSettings, error) {
	var value string
	err := q.QueryRowContext(ctx, "SELECT setting_value FROM board_settings WHERE setting_key='card_layout'").Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return BoardSettings{CardLayout: CardLayoutPack}, nil
	}
	if err != nil {
		return BoardSettings{}, err
	}
	return BoardSettings{CardLayout: normalizeCardLayout(value)}, nil
}

func (r MySQLRepository) UpdateBoardSettings(ctx context.Context, in BoardSettings) (BoardSettings, []Item, error) {
	layout := normalizeCardLayout(in.CardLayout)
	if in.CardLayout != CardLayoutPack && in.CardLayout != CardLayoutFree {
		return BoardSettings{}, nil, ErrBoardSettings
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	defer tx.Rollback()

	if _, err = lockColumnRows(ctx, tx); err != nil {
		return BoardSettings{}, nil, err
	}
	current, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	if _, err = tx.ExecContext(ctx, `
INSERT INTO board_settings(setting_key, setting_value) VALUES('card_layout', ?)
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`, layout); err != nil {
		return BoardSettings{}, nil, err
	}
	settings := BoardSettings{CardLayout: layout}
	if layout != CardLayoutPack {
		return settings, nil, tx.Commit()
	}
	if current.CardLayout == CardLayoutFree {
		if err = reassignPositionsByOffsetY(ctx, tx); err != nil {
			return BoardSettings{}, nil, err
		}
	}
	cards, err := listOrderedCards(ctx, tx)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	if err = tx.Commit(); err != nil {
		return BoardSettings{}, nil, err
	}
	return settings, cards, nil
}

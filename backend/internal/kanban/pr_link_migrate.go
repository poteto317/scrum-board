package kanban

import (
	"context"
	"fmt"
)

func tableExists(ctx context.Context, r MySQLRepository, name string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = ?`, name).Scan(&n)
	return n > 0, err
}

func hasPositionColumn(ctx context.Context, r MySQLRepository) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'card_pr_links' AND column_name = 'position'`).Scan(&n)
	return n > 0, err
}

// InitializePRLinks is additive for card/number data. It migrates the old
// single-URL schema (card_id PK) to multi-row (card_id, position).
// MySQL DDL auto-commits, so a crashed RENAME can leave card_pr_links__new
// behind; the next boot recovers that table before creating an empty one.
func (r MySQLRepository) InitializePRLinks(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_card_pr_links_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("card_pr_links migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_card_pr_links_migrate')")

	hasMain, err := tableExists(ctx, r, "card_pr_links")
	if err != nil {
		return err
	}
	hasNew, err := tableExists(ctx, r, "card_pr_links__new")
	if err != nil {
		return err
	}
	// Resume after DROP+failed RENAME: only __new remains with migrated rows.
	if !hasMain && hasNew {
		if _, err = r.DB.ExecContext(ctx, "RENAME TABLE card_pr_links__new TO card_pr_links"); err != nil {
			return err
		}
		return nil
	}
	if !hasMain {
		_, err = r.DB.ExecContext(ctx, cardPRLinksDDL)
		return err
	}
	ready, err := hasPositionColumn(ctx, r)
	if err != nil {
		return err
	}
	if ready {
		if hasNew {
			if _, err = r.DB.ExecContext(ctx, "DROP TABLE card_pr_links__new"); err != nil {
				return err
			}
		}
		return nil
	}
	// Leftover __new from a previous attempt: drop and rebuild so copy is complete.
	if hasNew {
		if _, err = r.DB.ExecContext(ctx, "DROP TABLE card_pr_links__new"); err != nil {
			return err
		}
	}
	if _, err = r.DB.ExecContext(ctx, cardPRLinksNewDDL); err != nil {
		return err
	}
	if _, err = r.DB.ExecContext(ctx, `
INSERT INTO card_pr_links__new (card_id, position, pr_url)
SELECT card_id, 0, pr_url FROM card_pr_links WHERE pr_url <> ''`); err != nil {
		return fmt.Errorf("migrate card_pr_links: %w", err)
	}
	// Swap: keep __new if RENAME fails after DROP (recovered on next boot).
	if _, err = r.DB.ExecContext(ctx, "DROP TABLE card_pr_links"); err != nil {
		return err
	}
	if _, err = r.DB.ExecContext(ctx, "RENAME TABLE card_pr_links__new TO card_pr_links"); err != nil {
		return err
	}
	return nil
}

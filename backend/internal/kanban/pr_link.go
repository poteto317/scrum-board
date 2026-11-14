package kanban

import (
	"context"
	"database/sql"
)

// pr_url is ASCII: GitHub PR URLs are ASCII-only, and utf8mb4 VARCHAR(2048)
// cannot sit in a UNIQUE index (max key length 3072 bytes).
const cardPRLinksDDL = `CREATE TABLE card_pr_links (
 card_id BIGINT NOT NULL,
 position INT NOT NULL,
 pr_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY (card_id, position),
 UNIQUE KEY uq_card_pr_url (card_id, pr_url),
 CONSTRAINT fk_card_pr_links_card FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

const cardPRLinksNewDDL = `CREATE TABLE card_pr_links__new (
 card_id BIGINT NOT NULL,
 position INT NOT NULL,
 pr_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY (card_id, position),
 UNIQUE KEY uq_card_pr_url (card_id, pr_url),
 CONSTRAINT fk_card_pr_links_card_new FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

func replacePRURLs(ctx context.Context, tx *sql.Tx, cardID int64, urls []string) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM card_pr_links WHERE card_id=?", cardID); err != nil {
		return err
	}
	for i, url := range urls {
		if _, err := tx.ExecContext(ctx, "INSERT INTO card_pr_links(card_id,position,pr_url) VALUES(?,?,?)", cardID, i, url); err != nil {
			return err
		}
	}
	return nil
}

type queryable interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func attachPRURLs(ctx context.Context, q queryable, cards []Card) error {
	for i := range cards {
		if cards[i].PRURLs == nil {
			cards[i].PRURLs = []string{}
		}
	}
	if len(cards) == 0 {
		return nil
	}
	ids := make([]any, len(cards))
	index := make(map[int64]int, len(cards))
	placeholders := make([]byte, 0, len(cards)*2)
	for i, c := range cards {
		ids[i] = c.ID
		index[c.ID] = i
		if i > 0 {
			placeholders = append(placeholders, ',')
		}
		placeholders = append(placeholders, '?')
	}
	rows, err := q.QueryContext(ctx, "SELECT card_id, pr_url FROM card_pr_links WHERE card_id IN ("+string(placeholders)+") ORDER BY card_id, position", ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var url string
		if err := rows.Scan(&id, &url); err != nil {
			return err
		}
		i, ok := index[id]
		if !ok {
			continue
		}
		cards[i].PRURLs = append(cards[i].PRURLs, url)
	}
	return rows.Err()
}

func attachPRURL(ctx context.Context, q queryable, c *Card) error {
	cards := []Card{*c}
	if err := attachPRURLs(ctx, q, cards); err != nil {
		return err
	}
	*c = cards[0]
	return nil
}

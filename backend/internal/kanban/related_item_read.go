package kanban

import (
	"context"
	"database/sql"
)

func attachRelatedItems(ctx context.Context, q queryable, cards []Item) error {
	for i := range cards {
		if cards[i].RelatedItems == nil {
			cards[i].RelatedItems = []RelatedItem{}
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
	query := `SELECT r.item_id, r.kind, r.related_item_id, COALESCE(r.url, ''), r.label, COALESCE(n.item_number, 0), COALESCE(c.title, '')
 FROM item_related_items r
 LEFT JOIN items c ON c.id = r.related_item_id
 LEFT JOIN item_numbers n ON n.item_id = r.related_item_id
 WHERE r.item_id IN (` + string(placeholders) + `) ORDER BY r.item_id, r.position`
	rows, err := q.QueryContext(ctx, query, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID int64
		var kind, itemURL, label, title string
		var relatedID sql.NullInt64
		var number int64
		if err := rows.Scan(&ownerID, &kind, &relatedID, &itemURL, &label, &number, &title); err != nil {
			return err
		}
		i, ok := index[ownerID]
		if !ok {
			continue
		}
		item := RelatedItem{Kind: kind, Label: label}
		if kind == relatedKindItem {
			item.Number = number
			item.Title = title
		} else {
			item.URL = itemURL
		}
		cards[i].RelatedItems = append(cards[i].RelatedItems, item)
	}
	return rows.Err()
}

func attachRelatedItem(ctx context.Context, q queryable, c *Item) error {
	cards := []Item{*c}
	if err := attachRelatedItems(ctx, q, cards); err != nil {
		return err
	}
	*c = cards[0]
	return nil
}

func listRelatedItemIDs(ctx context.Context, q queryable, cardID int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT related_item_id FROM item_related_items WHERE item_id=? AND kind=? ORDER BY position`, cardID, relatedKindItem)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

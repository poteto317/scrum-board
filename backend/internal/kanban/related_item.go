package kanban

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"time"
)

type relatedStored struct {
	kind          string
	relatedItemID int64
	number        int64
	url           string
	label         string
}

// lockCardsForRelatedReplace locks owner and all old/new peer cards in ascending id order.
func lockCardsForRelatedReplace(ctx context.Context, tx *sql.Tx, ownerID int64, items []RelatedItem) error {
	stored, err := resolveRelatedStored(ctx, tx, ownerID, items)
	if err != nil {
		return err
	}
	oldPeers, err := listRelatedItemIDs(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	ids := []int64{ownerID}
	ids = append(ids, oldPeers...)
	for _, s := range stored {
		if s.kind == relatedKindItem {
			ids = append(ids, s.relatedItemID)
		}
	}
	return lockItemIDs(ctx, tx, ids)
}

func lockItemIDs(ctx context.Context, tx *sql.Tx, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	uniq := map[int64]struct{}{}
	list := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := uniq[id]; ok {
			continue
		}
		uniq[id] = struct{}{}
		list = append(list, id)
	}
	sort.Slice(list, func(i, j int) bool { return list[i] < list[j] })
	for _, id := range list {
		var locked int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM items WHERE id=? FOR UPDATE", id).Scan(&locked); err != nil {
			return dbError(err)
		}
	}
	return nil
}

func resolveRelatedStored(ctx context.Context, tx *sql.Tx, ownerID int64, items []RelatedItem) ([]relatedStored, error) {
	out := make([]relatedStored, 0, len(items))
	for _, it := range items {
		switch it.Kind {
		case relatedKindItem:
			var peerID int64
			err := tx.QueryRowContext(ctx, "SELECT item_id FROM item_numbers WHERE item_number=?", it.Number).Scan(&peerID)
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrRelatedItem
			}
			if err != nil {
				return nil, err
			}
			if peerID == ownerID {
				return nil, ErrRelatedItem
			}
			out = append(out, relatedStored{kind: relatedKindItem, relatedItemID: peerID, number: it.Number, label: it.Label})
		case relatedKindURL:
			out = append(out, relatedStored{kind: relatedKindURL, url: it.URL, label: it.Label})
		default:
			return nil, ErrRelatedItem
		}
	}
	return out, nil
}

func insertRelatedRows(ctx context.Context, tx *sql.Tx, cardID int64, rows []relatedStored) error {
	for i, row := range rows {
		var related any
		var url any
		if row.kind == relatedKindItem {
			related = row.relatedItemID
			url = nil
		} else {
			related = nil
			url = row.url
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO item_related_items(item_id,position,kind,related_item_id,url,label) VALUES(?,?,?,?,?,?)`,
			cardID, i, row.kind, related, url, row.label); err != nil {
			return err
		}
	}
	return nil
}

func nextRelatedPosition(ctx context.Context, tx *sql.Tx, cardID int64) (int, error) {
	var max sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(position) FROM item_related_items WHERE item_id=?`, cardID).Scan(&max); err != nil {
		return 0, err
	}
	if !max.Valid {
		return 0, nil
	}
	return int(max.Int64) + 1, nil
}

func hasReverseRelated(ctx context.Context, tx *sql.Tx, ownerID, peerID int64) (bool, error) {
	var n int
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM item_related_items WHERE item_id=? AND kind=? AND related_item_id=?`,
		ownerID, relatedKindItem, peerID).Scan(&n)
	return n > 0, err
}

func compactRelatedPositions(ctx context.Context, tx *sql.Tx, cardID int64) error {
	// COALESCE: url is NULL for kind=item rows; Scan into string requires non-NULL.
	rows, err := tx.QueryContext(ctx,
		`SELECT kind, related_item_id, COALESCE(url, ''), label FROM item_related_items WHERE item_id=? ORDER BY position, related_item_id, url`, cardID)
	if err != nil {
		return err
	}
	var stored []relatedStored
	for rows.Next() {
		var kind, itemURL, label string
		var relatedID sql.NullInt64
		if err := rows.Scan(&kind, &relatedID, &itemURL, &label); err != nil {
			rows.Close()
			return err
		}
		s := relatedStored{kind: kind, label: label}
		if kind == relatedKindItem {
			s.relatedItemID = relatedID.Int64
		} else {
			s.url = itemURL
		}
		stored = append(stored, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if _, err := tx.ExecContext(ctx, `DELETE FROM item_related_items WHERE item_id=?`, cardID); err != nil {
		return err
	}
	return insertRelatedRows(ctx, tx, cardID, stored)
}

func touchCardUpdatedAt(ctx context.Context, tx *sql.Tx, cardID int64, at time.Time) error {
	_, err := tx.ExecContext(ctx, `UPDATE items SET updated_at=? WHERE id=?`, at, cardID)
	return err
}

func peerSetDiff(oldPeerSet, newPeerSet map[int64]struct{}) map[int64]struct{} {
	changed := map[int64]struct{}{}
	for id := range newPeerSet {
		if _, ok := oldPeerSet[id]; !ok {
			changed[id] = struct{}{}
		}
	}
	for id := range oldPeerSet {
		if _, ok := newPeerSet[id]; !ok {
			changed[id] = struct{}{}
		}
	}
	return changed
}

// syncPeerRelatedLinks adds/removes reverse card rows. Maintained peers keep label/order.
func syncPeerRelatedLinks(ctx context.Context, tx *sql.Tx, ownerID int64, oldPeerSet, newPeerSet map[int64]struct{}, now time.Time) error {
	for peerID := range newPeerSet {
		exists, err := hasReverseRelated(ctx, tx, peerID, ownerID)
		if err != nil {
			return err
		}
		if exists {
			continue // maintain: keep peer label/order; only repair if reverse missing
		}
		pos, err := nextRelatedPosition(ctx, tx, peerID)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx,
			`INSERT INTO item_related_items(item_id,position,kind,related_item_id,url,label) VALUES(?,?,?,?,NULL,'')`,
			peerID, pos, relatedKindItem, ownerID); err != nil {
			return err
		}
		if err = touchCardUpdatedAt(ctx, tx, peerID, now); err != nil {
			return err
		}
	}
	for peerID := range oldPeerSet {
		if _, keep := newPeerSet[peerID]; keep {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM item_related_items WHERE item_id=? AND kind=? AND related_item_id=?`,
			peerID, relatedKindItem, ownerID); err != nil {
			return err
		}
		if err := compactRelatedPositions(ctx, tx, peerID); err != nil {
			return err
		}
		if err := touchCardUpdatedAt(ctx, tx, peerID, now); err != nil {
			return err
		}
	}
	return nil
}

func peerCardsForHistory(ctx context.Context, tx *sql.Tx, befores map[int64]Item) ([][2]Item, error) {
	var peers [][2]Item
	for id, before := range befores {
		after, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
		if err != nil {
			return nil, err
		}
		peers = append(peers, [2]Item{before, after})
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i][0].ID < peers[j][0].ID })
	return peers, nil
}

// applyRelatedItemsPatch normalizes, replaces related rows, and writes history for peers that changed.
func applyRelatedItemsPatch(ctx context.Context, tx *sql.Tx, id int64, items []RelatedItem, now time.Time) error {
	normalized, ok := normalizeRelatedItems(items)
	if !ok {
		return ErrRelatedItem
	}
	peers, err := replaceRelatedItems(ctx, tx, id, normalized, now)
	if err != nil {
		return err
	}
	for _, pair := range peers {
		if err = appendHistory(ctx, tx, &pair[0], pair[1], "updated"); err != nil {
			return err
		}
	}
	return nil
}

// replaceRelatedItems rewrites owner card rows and syncs reverse card links.
// Returns peer cards whose relatedItems changed (before, after) for history.
func replaceRelatedItems(ctx context.Context, tx *sql.Tx, ownerID int64, items []RelatedItem, now time.Time) ([][2]Item, error) {
	stored, err := resolveRelatedStored(ctx, tx, ownerID, items)
	if err != nil {
		return nil, err
	}
	oldPeers, err := listRelatedItemIDs(ctx, tx, ownerID)
	if err != nil {
		return nil, err
	}
	newPeerSet := map[int64]struct{}{}
	for _, s := range stored {
		if s.kind == relatedKindItem {
			newPeerSet[s.relatedItemID] = struct{}{}
		}
	}
	oldPeerSet := map[int64]struct{}{}
	for _, id := range oldPeers {
		oldPeerSet[id] = struct{}{}
	}
	lockIDs := []int64{ownerID}
	for id := range oldPeerSet {
		lockIDs = append(lockIDs, id)
	}
	for id := range newPeerSet {
		lockIDs = append(lockIDs, id)
	}
	if err = lockItemIDs(ctx, tx, lockIDs); err != nil {
		return nil, err
	}

	changed := peerSetDiff(oldPeerSet, newPeerSet)
	befores := map[int64]Item{}
	for id := range changed {
		c, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
		if err != nil {
			return nil, err
		}
		befores[id] = c
	}

	if _, err = tx.ExecContext(ctx, `DELETE FROM item_related_items WHERE item_id=?`, ownerID); err != nil {
		return nil, err
	}
	if err = insertRelatedRows(ctx, tx, ownerID, stored); err != nil {
		return nil, err
	}
	if err = syncPeerRelatedLinks(ctx, tx, ownerID, oldPeerSet, newPeerSet, now); err != nil {
		return nil, err
	}
	return peerCardsForHistory(ctx, tx, befores)
}

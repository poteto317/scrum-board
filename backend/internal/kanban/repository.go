package kanban

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

type MySQLRepository struct{ DB *sql.DB }

func dbError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	var m *mysql.MySQLError
	if errors.As(err, &m) {
		switch m.Number {
		case 1062:
			if strings.Contains(m.Message, "item_related_items") ||
				strings.Contains(m.Message, "uq_item_related_") ||
				strings.Contains(m.Message, "uq_card_related_") {
				return ErrRelatedItem
			}
			return ErrDuplicate
		case 1451:
			return ErrProjectConflict
		case 1452:
			if strings.Contains(m.Message, "fk_item_project") || strings.Contains(m.Message, "project_id") {
				return ErrProject
			}
			return ErrColumn
		}
	}
	return err
}

type scanner interface{ Scan(...any) error }

func scanCard(s scanner) (Item, error) {
	var c Item
	var dueAt sql.NullTime
	err := s.Scan(&c.ID, &c.Number, &c.ColumnID, &c.ProjectID, &c.Title, &c.Description, &c.Solution, &c.Position, &c.OffsetY, &c.BacklogPosition, &c.Assignee, &c.CloseReason, &dueAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, dbError(err)
	}
	if dueAt.Valid {
		u := TruncateDueAtMinute(dueAt.Time)
		c.DueAt = &u
	}
	c.PRURLs = []string{}
	c.RelatedItems = []RelatedItem{}
	return c, nil
}

// numberedCards は item_pr_links を結合しない。PR リンクは 1 カード複数行なので、
// 結合すると PR の数だけカードが重複する。PR URL は attachPRURL(s) で別クエリで付ける。
// FOR UPDATE で使っても結合先の行までロックしない。
const cardFields = "c.id, n.item_number, c.column_id, c.project_id, c.title, c.description, c.solution, c.position, c.offset_y, c.backlog_position, c.assignee, c.close_reason, c.due_at, c.created_at, c.updated_at"
const numberedCards = " FROM items c JOIN item_numbers n ON n.item_id=c.id"

func loadCard(ctx context.Context, q interface {
	queryable
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, query string, args ...any) (Item, error) {
	c, err := scanCard(q.QueryRowContext(ctx, query, args...))
	if err != nil {
		return c, err
	}
	if err = attachPRURL(ctx, q, &c); err != nil {
		return c, err
	}
	if err = attachRelatedItem(ctx, q, &c); err != nil {
		return c, err
	}
	return c, nil
}

func (r MySQLRepository) Board(ctx context.Context) (Board, error) {
	b := Board{Columns: []Column{}, Items: []Item{}, Settings: BoardSettings{CardLayout: CardLayoutPack}}
	// A consistent snapshot prevents a concurrent column/card creation from splitting the board response.
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	b.Columns, err = listOrderedColumns(ctx, tx)
	if err != nil {
		return b, err
	}
	rawSettings, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return b, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return b, err
	}
	b.Settings = rawSettings
	b.Settings.MobileBoardColumnID = resolveMobileBoardColumnID(rawSettings.MobileBoardColumnID, b.Columns)
	active := resolveActiveProjectID(rawSettings.ActiveProjectID, projects)
	b.Settings.ActiveProjectID = active
	rows, err := tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.project_id=? ORDER BY c.position,c.id", active)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		c, e := scanCard(rows)
		if e != nil {
			return b, e
		}
		b.Items = append(b.Items, c)
	}
	if err = rows.Err(); err != nil {
		return b, err
	}
	rows.Close()
	if err = attachPRURLs(ctx, tx, b.Items); err != nil {
		return b, err
	}
	if err = attachRelatedItems(ctx, tx, b.Items); err != nil {
		return b, err
	}
	return b, tx.Commit()
}
func (r MySQLRepository) GetItem(ctx context.Context, id int64) (Item, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
}
func (r MySQLRepository) GetItemByNumber(ctx context.Context, number, projectID int64) (Item, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE n.project_id=? AND n.item_number=?", projectID, number)
}
func (r MySQLRepository) CreateItem(ctx context.Context, in ItemInput) (Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if err = lockExistingColumn(ctx, tx, in.ColumnID); err != nil {
		return Item{}, err
	}
	layout, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return Item{}, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return Item{}, err
	}
	projectID, err := resolveCreateProjectID(in, layout, projects)
	if err != nil {
		return Item{}, err
	}
	number, err := lockNextNumber(ctx, tx, projectID)
	if err != nil {
		return Item{}, err
	}
	nextPos, err := nextCardPosition(ctx, tx, in.ColumnID, projectID)
	if err != nil {
		return Item{}, err
	}
	offsetY := 0
	if layout.CardLayout == CardLayoutFree {
		offsetY, err = nextFreeOffsetY(ctx, tx, in.ColumnID, projectID)
		if err != nil {
			return Item{}, err
		}
	}
	nextBacklog, err := nextBacklogPosition(ctx, tx, projectID)
	if err != nil {
		return Item{}, err
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO items(column_id,project_id,title,description,solution,position,offset_y,backlog_position,assignee,close_reason) VALUES(?,?,?,?,?,?,?,?,?,?)", in.ColumnID, projectID, in.Title, in.Description, in.Solution, nextPos, offsetY, nextBacklog, in.Assignee, in.CloseReason)
	if err != nil {
		return Item{}, dbError(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Item{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO item_numbers(item_id,item_number,project_id) VALUES(?,?,?)", id, number, projectID); err != nil {
		return Item{}, dbError(err)
	}
	if _, err = tx.ExecContext(ctx, "UPDATE item_number_sequence SET next_number=? WHERE project_id=?", number+1, projectID); err != nil {
		return Item{}, err
	}
	if err = replacePRURLs(ctx, tx, id, in.PRURLs); err != nil {
		return Item{}, err
	}
	related := in.RelatedItems
	if related == nil {
		related = []RelatedItem{}
	}
	if err = applyRelatedItemsPatch(ctx, tx, id, related, time.Now().UTC()); err != nil {
		return Item{}, err
	}
	if err = copyCommandTemplateDefaultsToCard(ctx, tx, id); err != nil {
		return Item{}, err
	}
	card, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return Item{}, err
	}
	if err = appendHistory(ctx, tx, nil, card, "created"); err != nil {
		return Item{}, err
	}
	return card, tx.Commit()
}
func (r MySQLRepository) UpdateItem(ctx context.Context, id int64, p ItemPatch) (Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	// A column move takes the same all-columns lock as ReorderItems/CreateItem before touching any card (DeleteItem does too), so
	// InnoDB never sees two writers wait on each other's card and column rows. A PR-link rewrite takes it too:
	// replacePRURLs DELETEs a range that is empty for a card's first save and then INSERTs into it, and two such
	// transactions on different cards each hold the gap lock the other's INSERT waits for (deadlock, 1213).
	// A title/description-only edit does not touch item_pr_links, so it still locks just the owning card below.
	switch {
	case p.ColumnID != nil:
		if err = lockExistingColumn(ctx, tx, *p.ColumnID); err != nil {
			return Item{}, err
		}
	case p.ProjectID != nil:
		if _, err = lockColumnRows(ctx, tx); err != nil {
			return Item{}, err
		}
	case p.PRURLs != nil, p.RelatedItems != nil:
		if _, err = lockColumnRows(ctx, tx); err != nil {
			return Item{}, err
		}
	}
	// relatedItems touches peer card rows: lock owner+peers in id order (never owner-first then peers).
	if p.RelatedItems != nil {
		if err = lockCardsForRelatedReplace(ctx, tx, id, *p.RelatedItems); err != nil {
			return Item{}, err
		}
	} else {
		var lockedID int64
		if err = tx.QueryRowContext(ctx, "SELECT id FROM items WHERE id=? FOR UPDATE", id).Scan(&lockedID); err != nil {
			return Item{}, dbError(err)
		}
	}
	c, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return c, err
	}
	before := c
	now := time.Now().UTC()
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.Solution != nil {
		c.Solution = *p.Solution
	}
	sourceColumnID := c.ColumnID
	sourceProjectID := c.ProjectID
	projectChanged := false
	if p.ProjectID != nil && *p.ProjectID != c.ProjectID {
		projects, err := listProjects(ctx, tx)
		if err != nil {
			return Item{}, err
		}
		if *p.ProjectID <= 0 || !projectIDExists(projects, *p.ProjectID) {
			return Item{}, ErrProject
		}
		c.ProjectID = *p.ProjectID
		projectChanged = true
	}
	columnChanged := p.ColumnID != nil && *p.ColumnID != sourceColumnID
	if columnChanged {
		c.ColumnID = *p.ColumnID
	}
	if projectChanged {
		if err = repositionItemForProjectChange(ctx, tx, &c); err != nil {
			return Item{}, err
		}
		number, err := lockNextNumber(ctx, tx, c.ProjectID)
		if err != nil {
			return Item{}, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE item_numbers SET project_id=?, item_number=? WHERE item_id=?", c.ProjectID, number, id); err != nil {
			return Item{}, dbError(err)
		}
		if _, err = tx.ExecContext(ctx, "UPDATE item_number_sequence SET next_number=? WHERE project_id=?", number+1, c.ProjectID); err != nil {
			return Item{}, err
		}
		c.Number = number
	} else if columnChanged {
		nextPos, err := nextCardPosition(ctx, tx, c.ColumnID, c.ProjectID)
		if err != nil {
			return Item{}, err
		}
		layout, err := loadBoardSettings(ctx, tx)
		if err != nil {
			return Item{}, err
		}
		c.Position = nextPos
		if layout.CardLayout == CardLayoutFree {
			offsetY, err := nextFreeOffsetY(ctx, tx, c.ColumnID, c.ProjectID)
			if err != nil {
				return Item{}, err
			}
			c.OffsetY = offsetY
		}
	}
	if p.Assignee != nil {
		c.Assignee = *p.Assignee
	}
	if p.CloseReason != nil {
		c.CloseReason = *p.CloseReason
	}
	if p.ClearDueAt {
		c.DueAt = nil
	} else if p.DueAt != nil {
		u := TruncateDueAtMinute(*p.DueAt)
		c.DueAt = &u
	}
	_, err = tx.ExecContext(ctx, "UPDATE items SET title=?,description=?,solution=?,column_id=?,project_id=?,position=?,offset_y=?,backlog_position=?,assignee=?,close_reason=?,due_at=?,updated_at=? WHERE id=?", c.Title, c.Description, c.Solution, c.ColumnID, c.ProjectID, c.Position, c.OffsetY, c.BacklogPosition, c.Assignee, c.CloseReason, c.DueAt, now, id)
	if err != nil {
		return Item{}, dbError(err)
	}
	if p.PRURLs != nil {
		if err = replacePRURLs(ctx, tx, id, *p.PRURLs); err != nil {
			return Item{}, err
		}
	}
	if p.RelatedItems != nil {
		if err = applyRelatedItemsPatch(ctx, tx, id, *p.RelatedItems, now); err != nil {
			return Item{}, err
		}
	}
	if columnChanged && !projectChanged {
		if err = compactColumnPositions(ctx, tx, sourceColumnID, sourceProjectID); err != nil {
			return Item{}, err
		}
	}
	c, err = loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return c, err
	}
	if err = appendHistory(ctx, tx, &before, c, "updated"); err != nil {
		return Item{}, err
	}
	return c, tx.Commit()
}
func (r MySQLRepository) DeleteItem(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// DELETE locks the primary key and then items_column_position, the opposite of the secondary-then-primary
	// order of the column scans in lockCardsInColumns/nextCardPosition, so it joins the all-columns lock too.
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, "DELETE FROM items WHERE id=?", id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
func (r MySQLRepository) CreateColumn(ctx context.Context, name string) (Column, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Column{}, err
	}
	defer tx.Rollback()
	existing, err := lockColumnRows(ctx, tx)
	if err != nil {
		return Column{}, err
	}
	maxPos := -1
	for _, col := range existing {
		if col.Position > maxPos {
			maxPos = col.Position
		}
	}
	nextPos := maxPos + 1
	res, err := tx.ExecContext(ctx, "INSERT INTO board_columns(name,position) VALUES(?,?)", name, nextPos)
	if err != nil {
		return Column{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Column{}, err
	}
	var c Column
	if err = tx.QueryRowContext(ctx, "SELECT id,name,position FROM board_columns WHERE id=?", id).Scan(&c.ID, &c.Name, &c.Position); err != nil {
		return Column{}, err
	}
	return c, tx.Commit()
}

func (r MySQLRepository) GetColumnByName(ctx context.Context, name string) (Column, error) {
	var column Column
	err := r.DB.QueryRowContext(ctx, "SELECT id,name,position FROM board_columns WHERE name=?", name).Scan(&column.ID, &column.Name, &column.Position)
	if errors.Is(err, sql.ErrNoRows) {
		return Column{}, ErrColumn
	}
	return column, err
}

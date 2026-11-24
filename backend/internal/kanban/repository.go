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
	var dueAt, doneAt, archivedAt sql.NullTime
	var createdBy sql.NullInt64
	err := s.Scan(&c.ID, &c.Number, &c.ColumnID, &c.ProjectID, &c.Title, &c.Description, &c.Solution, &c.Position, &c.OffsetY, &c.BacklogPosition, &c.Assignee, &c.CloseReason, &c.Favorite, &dueAt, &doneAt, &archivedAt, &c.ViewAccess, &c.EditAccess, &createdBy, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, dbError(err)
	}
	if dueAt.Valid {
		u := TruncateDueAtMinute(dueAt.Time)
		c.DueAt = &u
	}
	if doneAt.Valid {
		c.DoneAt = &doneAt.Time
	}
	if archivedAt.Valid {
		c.ArchivedAt = &archivedAt.Time
	}
	if createdBy.Valid {
		id := createdBy.Int64
		c.CreatedByUserID = &id
	}
	if c.ViewAccess == "" {
		c.ViewAccess = ViewAccessOpen
	}
	if c.EditAccess == "" {
		c.EditAccess = EditAccessOpen
	}
	c.PRURLs = []string{}
	c.RelatedItems = []RelatedItem{}
	return c, nil
}

// cardFieldsHead / cardFieldsTail は、説明とソリューションの列の前後（カンマと空白を含む）。
// 全文用（cardFields）と一覧用（cardListFields）で、この 2 つの間だけを差し替える。
const cardFieldsHead = "c.id, n.item_number, c.column_id, c.project_id, c.title, "
const cardFieldsTail = ", c.position, c.offset_y, c.backlog_position, c.assignee, c.close_reason, c.favorite, c.due_at, c.done_at, c.archived_at, c.view_access, c.edit_access, c.created_by_user_id, c.created_at, c.updated_at"
const cardFields = cardFieldsHead + "c.description, c.solution" + cardFieldsTail

// listDescriptionRunes は一覧の応答に載せる説明の最大文字数（Unicode のコードポイント）。
// cardListFields の LEFT(...) の 500 と同じ値にする（const では組み込めないので、変えるときは SQL も直す。
// 食い違いは handler_test.go の cardListFields の整合テストが検知する）。
const listDescriptionRunes = 500

// cardListFields は一覧の応答用。説明を先頭 listDescriptionRunes 文字に切り、ソリューションは空にする。
// 列の並びは cardFields と同じなので scanCard で読める。全文は詳細の取得（cardFields）で返す。
const cardListFields = cardFieldsHead + "LEFT(c.description, 500), ''" + cardFieldsTail
// numberedCards は item_pr_links を結合しない。PR リンクは 1 カード複数行なので、
// 結合すると PR の数だけカードが重複する。PR URL は attachPRURL(s) で別クエリで付ける。
// FOR UPDATE で使っても結合先の行までロックしない。
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
	return r.loadBoard(ctx, 0)
}

func (r MySQLRepository) BoardForProject(ctx context.Context, projectID int64) (Board, error) {
	if projectID <= 0 {
		return Board{}, ErrProject
	}
	return r.loadBoard(ctx, projectID)
}

// boardHead is what loadBoardHead resolves inside one transaction. BoardMeta returns
// Columns and Settings; loadBoard also needs Projects to scope the items (the resolved
// active project is Settings.ActiveProjectID).
type boardHead struct {
	Columns  []Column
	Settings BoardSettings
	Projects []Project
}

// loadBoardHead reads columns, settings and projects inside tx and resolves the mobile
// column and active project. Shared by loadBoard and BoardMeta so the rules live in one place.
func loadBoardHead(ctx context.Context, tx *sql.Tx) (boardHead, error) {
	columns, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return boardHead{}, err
	}
	rawSettings, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return boardHead{}, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return boardHead{}, err
	}
	settings := rawSettings
	settings.MobileBoardColumnID = resolveMobileBoardColumnID(rawSettings.MobileBoardColumnID, columns)
	active := resolveActiveProjectID(rawSettings.ActiveProjectID, projects)
	settings.ActiveProjectID = active
	return boardHead{Columns: columns, Settings: settings, Projects: projects}, nil
}

// BoardMeta returns columns and resolved settings without reading items.
func (r MySQLRepository) BoardMeta(ctx context.Context) (BoardMeta, error) {
	empty := BoardMeta{Columns: []Column{}, Settings: BoardSettings{CardLayout: CardLayoutPack}}
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return empty, err
	}
	defer tx.Rollback()
	head, err := loadBoardHead(ctx, tx)
	if err != nil {
		return empty, err
	}
	return BoardMeta{Columns: head.Columns, Settings: head.Settings}, tx.Commit()
}

// ActiveProjectID resolves the active project from settings and projects only.
func (r MySQLRepository) ActiveProjectID(ctx context.Context) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rawSettings, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return 0, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return 0, err
	}
	return resolveActiveProjectID(rawSettings.ActiveProjectID, projects), tx.Commit()
}

// Columns returns the ordered columns without reading settings, projects or items.
func (r MySQLRepository) Columns(ctx context.Context) ([]Column, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	columns, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return nil, err
	}
	return columns, tx.Commit()
}

// loadBoard loads columns/settings with resolved active. If itemProjectID > 0, items are
// for that project (must exist); otherwise items use the resolved active project.
func (r MySQLRepository) loadBoard(ctx context.Context, itemProjectID int64) (Board, error) {
	b := Board{Columns: []Column{}, Items: []Item{}, Settings: BoardSettings{CardLayout: CardLayoutPack}}
	// A consistent snapshot prevents a concurrent column/card creation from splitting the board response.
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	head, err := loadBoardHead(ctx, tx)
	if err != nil {
		return b, err
	}
	b.Columns = head.Columns
	b.Settings = head.Settings
	scope, err := resolveItemListScope(head.Settings.ActiveProjectID, itemProjectID, head.Projects)
	if err != nil {
		return b, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT "+cardListFields+numberedCards+" WHERE c.project_id=? AND c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.position,c.id", scope)
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
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.deleted_at IS NULL", id)
}
func (r MySQLRepository) GetItemByNumber(ctx context.Context, number, projectID int64) (Item, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE n.project_id=? AND n.item_number=? AND c.deleted_at IS NULL", projectID, number)
}

func (r MySQLRepository) GetDeletedItem(ctx context.Context, id, projectID int64) (Item, error) {
	return loadCard(ctx, r.DB, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.project_id=? AND c.deleted_at IS NOT NULL", id, projectID)
}

func (r MySQLRepository) ListLivingItems(ctx context.Context) ([]Item, error) {
	rows, err := r.DB.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (r MySQLRepository) CreateItem(ctx context.Context, in ItemInput) (Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	card, err := createItemInTx(ctx, tx, in)
	if err != nil {
		return Item{}, err
	}
	return card, tx.Commit()
}

// createItemInTx inserts an item inside an existing transaction (no Commit).
// Used by CreateItem and RunRecurring so last_fired_at updates share the same TX (L-464).
func createItemInTx(ctx context.Context, tx *sql.Tx, in ItemInput) (Item, error) {
	if err := lockExistingColumn(ctx, tx, in.ColumnID); err != nil {
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
	doneAt, err := doneAtForColumn(ctx, tx, in.ColumnID)
	if err != nil {
		return Item{}, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO items(column_id,project_id,title,description,solution,position,offset_y,backlog_position,assignee,close_reason,favorite,done_at,view_access,edit_access,created_by_user_id)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, in.ColumnID, projectID, in.Title, in.Description, in.Solution, nextPos, offsetY, nextBacklog, in.Assignee, in.CloseReason, in.Favorite, doneAt, ViewAccessOpen, EditAccessOpen, in.CreatedByUserID)
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
	return card, nil
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
		if err = tx.QueryRowContext(ctx, "SELECT id FROM items WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL FOR UPDATE", id).Scan(&lockedID); err != nil {
			return Item{}, dbError(err)
		}
	}
	c, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.deleted_at IS NULL AND c.archived_at IS NULL", id)
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
		sourceFinished, err := isFinishedColumn(ctx, tx, sourceColumnID)
		if err != nil {
			return Item{}, err
		}
		targetFinished, err := isFinishedColumn(ctx, tx, *p.ColumnID)
		if err != nil {
			return Item{}, err
		}
		if targetFinished && !sourceFinished {
			c.DoneAt = &now
		} else if !targetFinished {
			c.DoneAt = nil
		}
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
		if err = deleteSprintItemsForItemTx(ctx, tx, id); err != nil {
			return Item{}, err
		}
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
	if p.Favorite != nil {
		c.Favorite = *p.Favorite
	}
	if p.ClearDueAt {
		c.DueAt = nil
	} else if p.DueAt != nil {
		u := TruncateDueAtMinute(*p.DueAt)
		c.DueAt = &u
	}
	_, err = tx.ExecContext(ctx, "UPDATE items SET title=?,description=?,solution=?,column_id=?,project_id=?,position=?,offset_y=?,backlog_position=?,assignee=?,close_reason=?,favorite=?,due_at=?,done_at=?,updated_at=? WHERE id=?", c.Title, c.Description, c.Solution, c.ColumnID, c.ProjectID, c.Position, c.OffsetY, c.BacklogPosition, c.Assignee, c.CloseReason, c.Favorite, c.DueAt, c.DoneAt, now, id)
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

// DeleteItem soft-deletes a living item (sets deleted_at). Already soft-deleted or missing → ErrNotFound.
// Other columns are left unchanged (L-015).
func (r MySQLRepository) DeleteItem(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Soft delete still joins the all-columns lock so writers stay ordered with Create/Update/Reorder.
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return err
	}
	now := time.Now().UTC()
	res, err := tx.ExecContext(ctx, "UPDATE items SET deleted_at=? WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL", now, id)
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
	if err = deleteSprintItemsForItemTx(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

// HardDeleteItem permanently removes a row (CASCADE children). Used by trash purge / hard delete.
func (r MySQLRepository) HardDeleteItem(ctx context.Context, id int64) error {
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

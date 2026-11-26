package kanban

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type memoryRepo struct {
	columns            []Column
	cards              map[int64]Item
	next               int64
	templates          []CommandTemplate
	nextTemplateID     int64
	cardTemplateIDs    map[int64][]int64
	defaultTemplateIDs []int64
	settings           BoardSettings
	settingsFail       error
	boardMetaFail      error
	boardCalls         atomic.Int64
	activeIDCalls      atomic.Int64
	columnsCalls       atomic.Int64
	getItemCalls       atomic.Int64
	aclListCalls       atomic.Int64
	aclListFail        error
	listFilter         *WorkspaceListFilters
	headerMenu         *WorkspaceHeaderMenu
	projects           []Project
	nextProject        int64
	comments           map[int64]Comment
	nextCommentID      int64
	users              []User
	nextUserID         int64
	sessions           map[string]Session
	aclEntries         map[int64]ItemACL
	sprints            map[int64]Sprint
	sprintItems        map[int64][]int64
	nextSprintID       int64
	recurringRules     map[int64]RecurringRule
	nextRecurringID    int64
	attachments        map[int64]memoryAttachment
	nextAttachmentID   int64
	aiMessages         map[int64]AIMessage
	nextAIMessageID    int64
	aiUsage            AIUsage
	projectAIMessages  map[int64]memoryProjectAIMessage
	// project chat conversations (ai_project_chat_memory_test.go)
	projectAIConversations      map[int64]memoryProjectAIConversation
	nextProjectAIConversationID int64
	projectAIClock              time.Time
	listLivingFail              error
	updateItemFail              error
	updateItemFailID            int64
}

func fresh() *memoryRepo {
	hash, err := HashPassword("test-password")
	if err != nil {
		panic(err)
	}
	now := time.Now().UTC()
	return &memoryRepo{
		columns:         []Column{{ID: 1, Name: "Todo"}, {ID: 2, Name: "Doing"}, {ID: 3, Name: "Done"}},
		cards:           map[int64]Item{},
		next:            1,
		nextTemplateID:  1,
		cardTemplateIDs: map[int64][]int64{},
		settings:        BoardSettings{CardLayout: CardLayoutPack, MobileBoardColumnID: 1, ActiveProjectID: 1},
		projects:        []Project{{ID: 1, Name: "メイン", Position: 0}},
		nextProject:     2,
		comments:        map[int64]Comment{},
		nextCommentID:   1,
		aiMessages:      map[int64]AIMessage{},
		nextAIMessageID: 1,
		users: []User{{
			ID: 1, LoginName: "admin", DisplayName: "admin",
			PasswordHash: hash, Role: RoleAdmin, Disabled: false,
			CreatedAt: now, UpdatedAt: now,
		}},
		nextUserID: 2,
		sessions: map[string]Session{
			HandlerTestSessionID: {ID: HandlerTestSessionID, UserID: 1, ExpiresAt: now.Add(time.Hour), CreatedAt: now},
		},
		aclEntries: map[int64]ItemACL{},
	}
}
func (m *memoryRepo) living(c Item) bool {
	return c.DeletedAt == nil
}

func (m *memoryRepo) Board(ctx context.Context) (Board, error) {
	m.boardCalls.Add(1)
	return m.boardForScope(0)
}

func (m *memoryRepo) BoardForProject(_ context.Context, projectID int64) (Board, error) {
	if projectID <= 0 || !m.projectExists(projectID) {
		return Board{}, ErrProject
	}
	return m.boardForScope(projectID)
}

// sortedColumns returns a copy of the columns ordered by position, then id.
func (m *memoryRepo) sortedColumns() []Column {
	cols := slices.Clone(m.columns)
	slices.SortFunc(cols, func(a, b Column) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return cols
}

func (m *memoryRepo) BoardMeta(_ context.Context) (BoardMeta, error) {
	if m.boardMetaFail != nil {
		return BoardMeta{}, m.boardMetaFail
	}
	cols := m.sortedColumns()
	return BoardMeta{Columns: cols, Settings: m.resolvedSettings(cols)}, nil
}

func (m *memoryRepo) ActiveProjectID(_ context.Context) (int64, error) {
	m.activeIDCalls.Add(1)
	return m.resolvedActive(), nil
}

func (m *memoryRepo) Columns(_ context.Context) ([]Column, error) {
	m.columnsCalls.Add(1)
	return m.sortedColumns(), nil
}

// listShaped は一覧の応答用の形（cardListFields と同じ）にする。説明は先頭 listDescriptionRunes 文字、ソリューションは空。
func listShaped(it Item) Item {
	if r := []rune(it.Description); len(r) > listDescriptionRunes {
		it.Description = string(r[:listDescriptionRunes])
	}
	it.Solution = ""
	return it
}

func (m *memoryRepo) boardForScope(itemProjectID int64) (Board, error) {
	cols := m.sortedColumns()
	active := m.resolvedActive()
	settings := m.resolvedSettings(cols)
	scope, err := resolveItemListScope(active, itemProjectID, m.projects)
	if err != nil {
		return Board{}, err
	}
	b := Board{Columns: cols, Items: []Item{}, Settings: settings}
	for _, c := range m.cards {
		if m.living(c) && c.ArchivedAt == nil && m.cardProjectID(c) == scope {
			b.Items = append(b.Items, listShaped(c))
		}
	}
	slices.SortFunc(b.Items, func(a, b Item) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return b, nil
}
func (m *memoryRepo) PatchBoardSettings(_ context.Context, patch BoardSettingsPatch) (BoardSettings, []Item, error) {
	if m.settingsFail != nil {
		return BoardSettings{}, nil, m.settingsFail
	}
	prev := normalizeCardLayout(m.settings.CardLayout)
	next, err := applyBoardSettingsPatch(m.settings, m.columns, m.projects, patch)
	if err != nil {
		return BoardSettings{}, nil, err
	}
	if patch.CardLayout != nil {
		if *patch.CardLayout != CardLayoutPack && *patch.CardLayout != CardLayoutFree {
			return BoardSettings{}, nil, ErrBoardSettings
		}
		m.settings.CardLayout = next.CardLayout
	}
	if patch.MobileBoardColumnID != nil {
		m.settings.MobileBoardColumnID = next.MobileBoardColumnID
	}
	if patch.ActiveProjectID != nil {
		m.settings.ActiveProjectID = next.ActiveProjectID
	}
	settings := m.resolvedSettings(m.columns)
	if !(prev == CardLayoutFree && m.settings.CardLayout == CardLayoutPack) {
		return settings, nil, nil
	}
	for _, col := range m.columns {
		var ids []int64
		for _, c := range m.cards {
			if c.ColumnID == col.ID {
				ids = append(ids, c.ID)
			}
		}
		slices.SortFunc(ids, func(a, b int64) int {
			ca, cb := m.cards[a], m.cards[b]
			if c := cmp.Compare(ca.OffsetY, cb.OffsetY); c != 0 {
				return c
			}
			if c := cmp.Compare(ca.Position, cb.Position); c != 0 {
				return c
			}
			return cmp.Compare(a, b)
		})
		for pos, id := range ids {
			c := m.cards[id]
			c.Position = pos
			m.cards[id] = c
		}
	}
	board, _ := m.Board(context.Background())
	return m.resolvedSettings(m.columns), board.Items, nil
}

func (m *memoryRepo) UpdateBoardSettings(ctx context.Context, in BoardSettings) (BoardSettings, []Item, error) {
	patch := BoardSettingsPatch{CardLayout: &in.CardLayout}
	if in.MobileBoardColumnID > 0 {
		id := in.MobileBoardColumnID
		patch.MobileBoardColumnID = &id
	}
	if in.ActiveProjectID > 0 {
		id := in.ActiveProjectID
		patch.ActiveProjectID = &id
	}
	return m.PatchBoardSettings(ctx, patch)
}
func (m *memoryRepo) resolvedActive() int64 {
	return resolveActiveProjectID(m.settings.ActiveProjectID, m.projects)
}
func (m *memoryRepo) resolvedSettings(cols []Column) BoardSettings {
	layout := m.settings.CardLayout
	if layout == "" {
		layout = CardLayoutPack
	}
	return BoardSettings{
		CardLayout:          normalizeCardLayout(layout),
		MobileBoardColumnID: resolveMobileBoardColumnID(m.settings.MobileBoardColumnID, cols),
		ActiveProjectID:     m.resolvedActive(),
	}
}
func (m *memoryRepo) cardProjectID(c Item) int64 {
	if c.ProjectID != 0 {
		return c.ProjectID
	}
	return 1
}
func (m *memoryRepo) validProject(id int64) bool {
	for _, p := range m.projects {
		if p.ID == id {
			return true
		}
	}
	return false
}
func (m *memoryRepo) GetItem(_ context.Context, id int64) (Item, error) {
	m.getItemCalls.Add(1)
	c, ok := m.cards[id]
	if !ok || !m.living(c) {
		return Item{}, ErrNotFound
	}
	return c, nil
}
func (m *memoryRepo) validColumn(id int64) bool {
	for _, c := range m.columns {
		if c.ID == id {
			return true
		}
	}
	return false
}
func (m *memoryRepo) nextPosition(columnID, projectID int64) int {
	maxPos := -1
	for _, c := range m.cards {
		if c.ColumnID == columnID && m.cardProjectID(c) == projectID && c.Position > maxPos {
			maxPos = c.Position
		}
	}
	return maxPos + 1
}
func (m *memoryRepo) nextBacklog(projectID int64) int {
	maxBacklog := -1
	for _, c := range m.cards {
		if m.cardProjectID(c) == projectID && c.BacklogPosition > maxBacklog {
			maxBacklog = c.BacklogPosition
		}
	}
	return maxBacklog + 1
}
func (m *memoryRepo) nextFreeOffset(columnID, projectID int64) int {
	maxOffset := -freePlacementStepY
	found := false
	for _, c := range m.cards {
		if c.ColumnID != columnID || m.cardProjectID(c) != projectID {
			continue
		}
		found = true
		if c.OffsetY > maxOffset {
			maxOffset = c.OffsetY
		}
	}
	if !found {
		return 0
	}
	next := maxOffset + freePlacementStepY
	if next > MaxOffsetY {
		return MaxOffsetY
	}
	return next
}
func (m *memoryRepo) compactColumn(columnID, projectID int64) {
	var ids []int64
	for _, c := range m.cards {
		if c.ColumnID == columnID && m.cardProjectID(c) == projectID {
			ids = append(ids, c.ID)
		}
	}
	slices.SortFunc(ids, func(a, b int64) int {
		ca, cb := m.cards[a], m.cards[b]
		if c := cmp.Compare(ca.Position, cb.Position); c != 0 {
			return c
		}
		return cmp.Compare(a, b)
	})
	for pos, id := range ids {
		c := m.cards[id]
		c.Position = pos
		m.cards[id] = c
	}
}
func (m *memoryRepo) CreateItem(_ context.Context, in ItemInput) (Item, error) {
	if !m.validColumn(in.ColumnID) {
		return Item{}, ErrColumn
	}
	projectID := m.resolvedActive()
	if in.ProjectID != nil {
		if *in.ProjectID <= 0 || !m.validProject(*in.ProjectID) {
			return Item{}, ErrProject
		}
		projectID = *in.ProjectID
	}
	if projectID <= 0 {
		return Item{}, ErrProject
	}
	urls := append([]string(nil), in.PRURLs...)
	if urls == nil {
		urls = []string{}
	}
	related := append([]RelatedItem(nil), in.RelatedItems...)
	if related == nil {
		related = []RelatedItem{}
	}
	offsetY := 0
	if normalizeCardLayout(m.settings.CardLayout) == CardLayoutFree {
		offsetY = m.nextFreeOffset(in.ColumnID, projectID)
	}
	id := m.next
	m.next++
	c := Item{
		Number: m.nextItemNumber(projectID), ID: id, ColumnID: in.ColumnID, ProjectID: projectID,
		Title: in.Title, Description: in.Description, Solution: in.Solution, PRURLs: urls, RelatedItems: related,
		Position: m.nextPosition(in.ColumnID, projectID), OffsetY: offsetY, Assignee: in.Assignee,
		CloseReason: in.CloseReason, Favorite: in.Favorite, BacklogPosition: m.nextBacklog(projectID),
		ViewAccess: ViewAccessOpen, EditAccess: EditAccessOpen, CreatedByUserID: in.CreatedByUserID,
	}
	m.cards[c.ID] = c
	m.cardTemplateIDs[c.ID] = append([]int64(nil), m.defaultTemplateIDs...)
	return c, nil
}
func (m *memoryRepo) nextItemNumber(projectID int64) int64 {
	var max int64
	for _, card := range m.cards {
		if m.cardProjectID(card) == projectID && card.Number > max {
			max = card.Number
		}
	}
	return max + 1
}
func (m *memoryRepo) UpdateItem(ctx context.Context, id int64, p ItemPatch) (Item, error) {
	if m.updateItemFail != nil && (m.updateItemFailID == 0 || m.updateItemFailID == id) {
		return Item{}, m.updateItemFail
	}
	c, err := m.GetItem(ctx, id)
	if err != nil {
		return c, err
	}
	if p.ColumnID != nil && !m.validColumn(*p.ColumnID) {
		return c, ErrColumn
	}
	if p.ProjectID != nil && (*p.ProjectID <= 0 || !m.validProject(*p.ProjectID)) {
		return c, ErrProject
	}
	sourceColumn := c.ColumnID
	sourceProject := m.cardProjectID(c)
	destColumn := sourceColumn
	if p.ColumnID != nil {
		destColumn = *p.ColumnID
	}
	destProject := sourceProject
	if p.ProjectID != nil {
		destProject = *p.ProjectID
	}
	if destProject != sourceProject {
		c.ProjectID = destProject
		c.Number = m.nextItemNumber(destProject)
		c.ColumnID = destColumn
		c.Position = m.nextPosition(destColumn, destProject)
		c.BacklogPosition = m.nextBacklog(destProject)
		if normalizeCardLayout(m.settings.CardLayout) == CardLayoutFree {
			c.OffsetY = m.nextFreeOffset(destColumn, destProject)
		}
		_ = m.DeleteSprintItemsForItem(ctx, id)
	} else if destColumn != sourceColumn {
		c.ColumnID = destColumn
		c.Position = m.nextPosition(destColumn, destProject)
		if normalizeCardLayout(m.settings.CardLayout) == CardLayoutFree {
			c.OffsetY = m.nextFreeOffset(destColumn, destProject)
		}
		m.cards[id] = c
		m.compactColumn(sourceColumn, sourceProject)
		c = m.cards[id]
	}
	if p.Title != nil {
		c.Title = *p.Title
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.Solution != nil {
		c.Solution = *p.Solution
	}
	if p.Favorite != nil {
		c.Favorite = *p.Favorite
	}
	if p.PRURLs != nil {
		c.PRURLs = append([]string(nil), (*p.PRURLs)...)
		if c.PRURLs == nil {
			c.PRURLs = []string{}
		}
	}
	if p.RelatedItems != nil {
		c.RelatedItems = append([]RelatedItem(nil), (*p.RelatedItems)...)
		if c.RelatedItems == nil {
			c.RelatedItems = []RelatedItem{}
		}
		// Bidirectional sync is MySQL-only (integration tests); memory stub stores owner rows only.
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
		u := p.DueAt.UTC().Truncate(time.Minute)
		c.DueAt = &u
	}
	m.cards[id] = c
	return c, nil
}
func (m *memoryRepo) ReorderItems(_ context.Context, orders []ItemColumnOrder) ([]Item, error) {
	if err := validateItemOrder(orders); err != nil {
		return nil, err
	}
	for _, order := range orders {
		if !m.validColumn(order.ColumnID) {
			return nil, ErrItemOrderMismatch
		}
	}
	requested := map[int64]struct{}{}
	for _, order := range orders {
		for _, id := range order.ItemIDs {
			requested[id] = struct{}{}
		}
	}
	listed := map[int64]struct{}{}
	for _, order := range orders {
		listed[order.ColumnID] = struct{}{}
	}
	active := m.resolvedActive()
	existing := map[int64]Item{}
	for _, c := range m.cards {
		if !m.living(c) {
			continue
		}
		if _, ok := listed[c.ColumnID]; ok && m.cardProjectID(c) == active {
			existing[c.ID] = c
		}
	}
	if len(existing) != len(requested) {
		return nil, ErrItemOrderMismatch
	}
	for id := range requested {
		if _, ok := existing[id]; !ok {
			return nil, ErrItemOrderMismatch
		}
	}
	for _, order := range orders {
		for pos, id := range order.ItemIDs {
			c := m.cards[id]
			c.ColumnID = order.ColumnID
			c.Position = pos
			if order.OffsetYs != nil {
				c.OffsetY = (*order.OffsetYs)[pos]
			}
			m.cards[id] = c
		}
	}
	board, _ := m.Board(context.Background())
	return board.Items, nil
}
func (m *memoryRepo) DeleteItem(ctx context.Context, id int64) error {
	c, err := m.GetItem(ctx, id)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	c.DeletedAt = &now
	m.cards[id] = c
	_ = m.DeleteSprintItemsForItem(ctx, id)
	return nil
}

func (m *memoryRepo) HardDeleteItem(ctx context.Context, id int64) error {
	if _, ok := m.cards[id]; !ok {
		return ErrNotFound
	}
	_ = ctx
	delete(m.cards, id)
	for cid, comment := range m.comments {
		if comment.ItemID == id {
			delete(m.comments, cid)
		}
	}
	for mid, msg := range m.aiMessages {
		if msg.ItemID == id {
			delete(m.aiMessages, mid)
		}
	}
	return nil
}

func (m *memoryRepo) HardDeleteTrashItem(ctx context.Context, id, projectID int64) error {
	c, ok := m.cards[id]
	if !ok || m.living(c) || m.cardProjectID(c) != projectID {
		return ErrNotFound
	}
	return m.HardDeleteItem(ctx, id)
}

func (m *memoryRepo) ListTrash(_ context.Context, projectID int64) ([]TrashEntry, error) {
	cutoff := trashCutoff(time.Now().UTC())
	out := []TrashEntry{}
	for _, c := range m.cards {
		if m.living(c) || m.cardProjectID(c) != projectID || c.DeletedAt == nil || !c.DeletedAt.After(cutoff) {
			continue
		}
		state := aclStateFromItem(c)
		if acl, ok := m.aclEntries[c.ID]; ok {
			state.ViewUserIDs = acl.ViewUserIDs
			state.EditUserIDs = acl.EditUserIDs
		}
		out = append(out, TrashEntry{
			TrashItem: TrashItem{ID: c.ID, Number: c.Number, Title: c.Title, ProjectID: m.cardProjectID(c), DeletedAt: *c.DeletedAt},
			ACL:       state,
		})
	}
	slices.SortFunc(out, func(a, b TrashEntry) int {
		if c := b.DeletedAt.Compare(a.DeletedAt); c != 0 {
			return c
		}
		return cmp.Compare(b.ID, a.ID)
	})
	return out, nil
}

func (m *memoryRepo) RestoreItem(ctx context.Context, id, projectID int64) (Item, error) {
	c, ok := m.cards[id]
	if !ok || m.living(c) || m.cardProjectID(c) != projectID {
		return Item{}, ErrNotFound
	}
	if !m.validColumn(c.ColumnID) {
		todo, err := m.GetColumnByName(ctx, "Todo")
		if err != nil {
			return Item{}, err
		}
		c.ColumnID = todo.ID
	}
	c.DeletedAt = nil
	m.cards[id] = c
	return c, nil
}

func (m *memoryRepo) PurgeExpiredTrash(ctx context.Context) (int64, error) {
	return m.purgeExpiredMemory(ctx)
}

func (m *memoryRepo) purgeExpiredMemory(_ context.Context) (int64, error) {
	cutoff := trashCutoff(time.Now().UTC())
	var n int64
	for id, c := range m.cards {
		if c.DeletedAt == nil || c.DeletedAt.After(cutoff) {
			continue
		}
		delete(m.cards, id)
		for cid, comment := range m.comments {
			if comment.ItemID == id {
				delete(m.comments, cid)
			}
		}
		n++
	}
	return n, nil
}
func (m *memoryRepo) CreateColumn(_ context.Context, name string) (Column, error) {
	maxPos := -1
	var maxID int64
	for _, c := range m.columns {
		if strings.EqualFold(c.Name, name) {
			return Column{}, ErrDuplicate
		}
		if c.Position > maxPos {
			maxPos = c.Position
		}
		if c.ID > maxID {
			maxID = c.ID
		}
	}
	c := Column{ID: maxID + 1, Name: name, Position: maxPos + 1}
	m.columns = append(m.columns, c)
	return c, nil
}

func (m *memoryRepo) ReorderColumns(_ context.Context, columnIDs []int64) ([]Column, error) {
	if err := validateColumnOrder(columnIDs); err != nil {
		return nil, err
	}
	if len(columnIDs) != len(m.columns) {
		return nil, ErrColumnMismatch
	}
	byID := make(map[int64]Column, len(m.columns))
	for _, c := range m.columns {
		byID[c.ID] = c
	}
	next := make([]Column, len(columnIDs))
	for i, colID := range columnIDs {
		col, ok := byID[colID]
		if !ok {
			return nil, ErrColumnMismatch
		}
		col.Position = i
		next[i] = col
	}
	m.columns = next
	return slices.Clone(next), nil
}

func (m *memoryRepo) Backlog(ctx context.Context) ([]Item, error) {
	return m.backlogForScope(0)
}

func (m *memoryRepo) BacklogForProject(_ context.Context, projectID int64) ([]Item, error) {
	if projectID <= 0 || !m.projectExists(projectID) {
		return nil, ErrProject
	}
	return m.backlogForScope(projectID)
}

func (m *memoryRepo) backlogForScope(itemProjectID int64) ([]Item, error) {
	active := m.resolvedActive()
	scope, err := resolveItemListScope(active, itemProjectID, m.projects)
	if err != nil {
		return nil, err
	}
	cards := []Item{}
	for _, c := range m.cards {
		if m.living(c) && m.cardProjectID(c) == scope {
			cards = append(cards, listShaped(c))
		}
	}
	slices.SortFunc(cards, func(a, b Item) int {
		if c := cmp.Compare(a.BacklogPosition, b.BacklogPosition); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return cards, nil
}

func (m *memoryRepo) projectExists(id int64) bool {
	for _, p := range m.projects {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (m *memoryRepo) ReorderBacklog(_ context.Context, cardIDs []int64) ([]Item, error) {
	if err := validateBacklogOrder(cardIDs); err != nil {
		return nil, err
	}
	active := m.resolvedActive()
	byID := map[int64]Item{}
	for _, c := range m.cards {
		if m.living(c) && m.cardProjectID(c) == active {
			byID[c.ID] = c
		}
	}
	if len(cardIDs) != len(byID) {
		return nil, ErrBacklogMismatch
	}
	for i, id := range cardIDs {
		if _, ok := byID[id]; !ok {
			return nil, ErrBacklogMismatch
		}
		c := m.cards[id]
		c.BacklogPosition = i
		m.cards[id] = c
	}
	return m.Backlog(context.Background())
}
func (m *memoryRepo) ListProjects(context.Context) ([]Project, error) {
	out := slices.Clone(m.projects)
	slices.SortFunc(out, func(a, b Project) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	if out == nil {
		out = []Project{}
	}
	return out, nil
}
func (m *memoryRepo) CreateProject(_ context.Context, name string) (Project, error) {
	name, err := normalizeProjectName(name)
	if err != nil {
		return Project{}, err
	}
	maxPos := -1
	for _, p := range m.projects {
		if p.Position > maxPos {
			maxPos = p.Position
		}
	}
	now := time.Now().UTC()
	id := m.nextProject
	if id <= 0 {
		id = 1
	}
	m.nextProject = id + 1
	p := Project{ID: id, Name: name, Position: maxPos + 1, CreatedAt: now, UpdatedAt: now}
	m.projects = append(m.projects, p)
	return p, nil
}
func (m *memoryRepo) UpdateProject(_ context.Context, id int64, name string) (Project, error) {
	name, err := normalizeProjectName(name)
	if err != nil {
		return Project{}, err
	}
	for i, p := range m.projects {
		if p.ID == id {
			p.Name = name
			p.UpdatedAt = time.Now().UTC()
			m.projects[i] = p
			return p, nil
		}
	}
	return Project{}, ErrNotFound
}
func (m *memoryRepo) DeleteProject(_ context.Context, id int64) error {
	found := false
	for _, p := range m.projects {
		if p.ID == id {
			found = true
			break
		}
	}
	if !found {
		return ErrNotFound
	}
	var n int
	for _, c := range m.cards {
		if m.cardProjectID(c) == id {
			n++
		}
	}
	if n > 0 || len(m.projects) <= 1 {
		return ErrProjectConflict
	}
	m.ensureSprints()
	for sid, s := range m.sprints {
		if s.ProjectID == id {
			delete(m.sprints, sid)
			delete(m.sprintItems, sid)
		}
	}
	next := make([]Project, 0, len(m.projects)-1)
	for _, p := range m.projects {
		if p.ID != id {
			next = append(next, p)
		}
	}
	m.projects = next
	m.dropProjectAIMessages(id) // mirrors ON DELETE CASCADE
	return nil
}
func (m *memoryRepo) ReorderProjects(_ context.Context, projectIDs []int64) ([]Project, error) {
	if err := validateProjectOrder(projectIDs); err != nil {
		return nil, err
	}
	if !sameProjectIDSet(m.projects, projectIDs) {
		return nil, ErrProjectMismatch
	}
	byID := make(map[int64]Project, len(m.projects))
	for _, p := range m.projects {
		byID[p.ID] = p
	}
	now := time.Now().UTC()
	next := make([]Project, 0, len(projectIDs))
	for pos, id := range projectIDs {
		p := byID[id]
		p.Position = pos
		p.UpdatedAt = now
		next = append(next, p)
	}
	m.projects = next
	out, err := m.ListProjects(context.Background())
	return out, err
}
func request(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	return requestWithCookie(h, method, path, body, HandlerTestSessionID)
}

func requestAnon(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	return requestWithCookie(h, method, path, body, "")
}

func requestScheduler(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set(SchedulerTokenHeader, HandlerTestSchedulerToken)
	h.ServeHTTP(w, r)
	return w
}

func requestWithCookie(h http.Handler, method, path, body, sessionID string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if sessionID != "" {
		r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: sessionID})
	}
	h.ServeHTTP(w, r)
	return w
}

func requestWithBasic(h http.Handler, method, path, body, user, pass string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetBasicAuth(user, pass)
	h.ServeHTTP(w, r)
	return w
}

func TestValidation(t *testing.T) {
	cases := []struct {
		name, method, path, body string
		status                   int
	}{
		{"blank title", "POST", "/api/items", `{"title":"　 ","columnId":1}`, 400},
		{"long title", "POST", "/api/items", `{"title":"` + strings.Repeat("あ", 201) + `","columnId":1}`, 400},
		{"unknown column", "POST", "/api/items", `{"title":"学習","columnId":99}`, 400},
		{"blank column", "POST", "/api/columns", `{"name":" "}`, 400},
		{"duplicate column", "POST", "/api/columns", `{"name":"Todo"}`, 409},
		{"missing card", "GET", "/api/items/999", "", 404},
		{"unknown field", "POST", "/api/items", `{"title":"x","columnId":1,"oops":true}`, 400},
		{"multiple JSON", "POST", "/api/columns", `{"name":"Review"} {}`, 400},
		{"bad id", "GET", "/api/items/no", "", 400},
		{"empty patch", "PATCH", "/api/items/1", `{}`, 400},
		{"null patch", "PATCH", "/api/items/1", `{"title":null}`, 400},
		{"related bad kind", "PATCH", "/api/items/1", `{"relatedItems":[{"kind":"file","url":"https://a.com"}]}`, 400},
		{"related null", "PATCH", "/api/items/1", `{"relatedItems":null}`, 400},
		{"related ftp", "PATCH", "/api/items/1", `{"relatedItems":[{"kind":"url","url":"ftp://a.com"}]}`, 400},
		{"related label control", "PATCH", "/api/items/1", `{"relatedItems":[{"kind":"url","url":"https://a.com","label":"a\nb"}]}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := fresh()
			if tc.method == "PATCH" && strings.Contains(tc.path, "/api/items/1") {
				if _, err := m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "seed", Description: ""}); err != nil {
					t.Fatal(err)
				}
			}
			w := request(NewHandler(m), tc.method, tc.path, tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}
func TestCardLifecycleAndPartialUpdate(t *testing.T) {
	h := NewHandler(fresh())
	w := request(h, "POST", "/api/items", `{"title":" 日本語の学習 ","description":"AngularとGo","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var c Item
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.Title != "日本語の学習" {
		t.Fatal(c)
	}
	w = request(h, "PATCH", "/api/items/1", `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.ColumnID != 2 || c.Title != "日本語の学習" || c.Description != "AngularとGo" {
		t.Fatal(c)
	}
	w = request(h, "PATCH", "/api/items/1", `{"columnId":99}`)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	w = request(h, "GET", "/api/board", "")
	var b Board
	json.Unmarshal(w.Body.Bytes(), &b)
	if w.Code != 200 || len(b.Items) != 1 || b.Items[0].ColumnID != 2 {
		t.Fatal(w.Body)
	}
	if w = request(h, "DELETE", "/api/items/1", ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w = request(h, "GET", "/api/items/1", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w = request(h, "POST", "/api/columns", `{"name":" レビュー "}`); w.Code != 201 {
		t.Fatal(w.Body)
	}
}

func TestUnicodeValidationBoundaries(t *testing.T) {
	h := NewHandler(fresh())
	payload := `{"columnId":1,"title":"` + strings.Repeat("🧪", 200) + `","description":"` + strings.Repeat("あ", 10000) + `"}`
	if w := request(h, "POST", "/api/items", payload); w.Code != 201 {
		t.Fatalf("Unicode boundary: %d %s", w.Code, w.Body)
	}
	payload = `{"columnId":1,"title":"学習","description":"` + strings.Repeat(" ", 10001) + `"}`
	if w := request(h, "POST", "/api/items", payload); w.Code != 400 {
		t.Fatalf("description overflow: %d", w.Code)
	}
	if w := request(h, "POST", "/api/columns", `{"name":"`+strings.Repeat("列", 60)+`"}`); w.Code != 201 {
		t.Fatalf("column boundary: %d", w.Code)
	}
	if w := request(h, "POST", "/api/columns", `{"name":"`+strings.Repeat("列", 61)+`"}`); w.Code != 400 {
		t.Fatalf("column overflow: %d", w.Code)
	}
}

func (m *memoryRepo) GetItemByNumber(_ context.Context, number, projectID int64) (Item, error) {
	for _, card := range m.cards {
		if m.living(card) && card.Number == number && m.cardProjectID(card) == projectID {
			return card, nil
		}
	}
	return Item{}, ErrNotFound
}

func (m *memoryRepo) UserCanResolvePRURL(_ context.Context, user *User, prURL string) (bool, error) {
	if user == nil || user.Disabled || !validPRURL(prURL) {
		return false, nil
	}
	for _, card := range m.cards {
		if !m.living(card) {
			continue
		}
		linked := false
		for _, u := range card.PRURLs {
			if u == prURL {
				linked = true
				break
			}
		}
		if !linked {
			continue
		}
		if CanView(aclStateFromItem(card), user) {
			return true, nil
		}
	}
	return false, nil
}

func (m *memoryRepo) GetDeletedItem(_ context.Context, id, projectID int64) (Item, error) {
	c, ok := m.cards[id]
	if !ok || m.living(c) || m.cardProjectID(c) != projectID {
		return Item{}, ErrNotFound
	}
	return c, nil
}

func (m *memoryRepo) ListLivingItems(_ context.Context) ([]Item, error) {
	if m.listLivingFail != nil {
		return nil, m.listLivingFail
	}
	out := []Item{}
	for _, c := range m.cards {
		if m.living(c) && c.ArchivedAt == nil {
			out = append(out, c)
		}
	}
	return out, nil
}
func TestGetItemByNumberProjectDistinguishesDuplicateNumbers(t *testing.T) {
	repo := fresh()
	repo.projects = append(repo.projects, Project{ID: 2, Name: "Other", Position: 1})
	repo.cards[10] = Item{ID: 10, Number: 5, ColumnID: 1, Title: "main five", ProjectID: 1}
	repo.cards[20] = Item{ID: 20, Number: 5, ColumnID: 1, Title: "other five", ProjectID: 2}
	h := NewHandler(repo)
	for _, tc := range []struct {
		query string
		id    int64
		title string
	}{{"?projectId=1", 10, "main five"}, {"?projectId=2", 20, "other five"}} {
		w := request(h, "GET", "/api/items/by-number/5"+tc.query, "")
		var card Item
		_ = json.Unmarshal(w.Body.Bytes(), &card)
		if w.Code != 200 || card.ID != tc.id || card.Title != tc.title {
			t.Fatalf("%s: %d %+v", tc.query, w.Code, card)
		}
	}
}

func TestGetItemByNumber(t *testing.T) {
	repo := fresh()
	repo.cards[18] = Item{ID: 18, Number: 3, ColumnID: 1, Title: "number three"}
	repo.cards[3] = Item{ID: 3, Number: 18, ColumnID: 1, Title: "number eighteen"}
	h := NewHandler(repo)
	for _, tc := range []struct {
		path       string
		id, number int64
	}{{"/api/items/by-number/3", 18, 3}, {"/api/items/by-number/18", 3, 18}, {"/api/items/18", 18, 3}} {
		w := request(h, "GET", tc.path, "")
		var card Item
		_ = json.Unmarshal(w.Body.Bytes(), &card)
		if w.Code != 200 || card.ID != tc.id || card.Number != tc.number {
			t.Fatalf("%s: %d %+v", tc.path, w.Code, card)
		}
	}
	for _, tc := range []struct {
		number string
		status int
	}{{"999", 404}, {"0", 400}, {"-1", 400}, {"abc", 400}, {"9223372036854775808", 400}} {
		w := request(h, "GET", "/api/items/by-number/"+tc.number, "")
		if w.Code != tc.status {
			t.Fatalf("%s: %d", tc.number, w.Code)
		}
	}
}

func (m *memoryRepo) GetColumnByName(_ context.Context, name string) (Column, error) {
	for _, c := range m.columns {
		if strings.EqualFold(c.Name, name) {
			return c, nil
		}
	}
	return Column{}, ErrColumn
}

func (m *memoryRepo) History(ctx context.Context, number, projectID, before int64) (HistoryPage, error) {
	_, err := m.GetItemByNumber(ctx, number, projectID)
	return HistoryPage{Events: []HistoryEvent{}}, err
}

func (m *memoryRepo) ListCommandTemplates(context.Context) ([]CommandTemplate, error) {
	out := append([]CommandTemplate(nil), m.templates...)
	slices.SortFunc(out, func(a, b CommandTemplate) int {
		if c := cmp.Compare(a.Position, b.Position); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	if out == nil {
		out = []CommandTemplate{}
	}
	return out, nil
}

func (m *memoryRepo) CreateCommandTemplate(_ context.Context, in CommandTemplateInput) (CommandTemplate, error) {
	if len(m.templates) >= MaxCommandTemplates {
		return CommandTemplate{}, ErrCommandTemplateLimit
	}
	if m.nextTemplateID < 1 {
		m.nextTemplateID = 1
	}
	maxPos := -1
	for _, item := range m.templates {
		if item.Position > maxPos {
			maxPos = item.Position
		}
	}
	item := CommandTemplate{ID: m.nextTemplateID, Name: in.Name, Template: in.Template, Position: maxPos + 1}
	m.nextTemplateID++
	m.templates = append(m.templates, item)
	return item, nil
}

func (m *memoryRepo) UpdateCommandTemplate(_ context.Context, id int64, p CommandTemplatePatch) (CommandTemplate, error) {
	for i, item := range m.templates {
		if item.ID != id {
			continue
		}
		if p.Name != nil {
			item.Name = *p.Name
		}
		if p.Template != nil {
			item.Template = *p.Template
		}
		m.templates[i] = item
		return item, nil
	}
	return CommandTemplate{}, ErrNotFound
}

func (m *memoryRepo) DeleteCommandTemplate(_ context.Context, id int64) error {
	for i, item := range m.templates {
		if item.ID != id {
			continue
		}
		m.templates = append(m.templates[:i], m.templates[i+1:]...)
		m.defaultTemplateIDs = removeID(m.defaultTemplateIDs, id)
		for cardID, ids := range m.cardTemplateIDs {
			m.cardTemplateIDs[cardID] = removeID(ids, id)
		}
		return nil
	}
	return ErrNotFound
}

func removeID(ids []int64, id int64) []int64 {
	out := make([]int64, 0, len(ids))
	for _, v := range ids {
		if v != id {
			out = append(out, v)
		}
	}
	return out
}

func (m *memoryRepo) catalogByID(id int64) (CommandTemplate, bool) {
	for _, item := range m.templates {
		if item.ID == id {
			return item, true
		}
	}
	return CommandTemplate{}, false
}

func (m *memoryRepo) validateTemplateIDs(ids []int64) error {
	for _, id := range ids {
		if _, ok := m.catalogByID(id); !ok {
			return ErrUnknownCommandTemplateIDs
		}
	}
	return nil
}

func (m *memoryRepo) ListItemCommandTemplates(_ context.Context, cardID int64) ([]CommandTemplate, error) {
	c, ok := m.cards[cardID]
	if !ok || !m.living(c) {
		return nil, ErrNotFound
	}
	ids := m.cardTemplateIDs[cardID]
	list := []CommandTemplate{}
	for i, id := range ids {
		item, ok := m.catalogByID(id)
		if !ok {
			continue
		}
		item.Position = i
		list = append(list, item)
	}
	return list, nil
}

func (m *memoryRepo) ReplaceItemCommandTemplates(_ context.Context, cardID int64, templateIDs []int64) ([]CommandTemplate, error) {
	c, ok := m.cards[cardID]
	if !ok || !m.living(c) {
		return nil, ErrNotFound
	}
	ids := dedupeTemplateIDs(templateIDs)
	if err := m.validateTemplateIDs(ids); err != nil {
		return nil, err
	}
	m.cardTemplateIDs[cardID] = append([]int64(nil), ids...)
	return m.ListItemCommandTemplates(context.Background(), cardID)
}

func (m *memoryRepo) ListCommandTemplateDefaults(context.Context) ([]int64, error) {
	if m.defaultTemplateIDs == nil {
		return []int64{}, nil
	}
	return append([]int64(nil), m.defaultTemplateIDs...), nil
}

func (m *memoryRepo) ReplaceCommandTemplateDefaults(_ context.Context, templateIDs []int64) ([]int64, error) {
	ids := dedupeTemplateIDs(templateIDs)
	if err := m.validateTemplateIDs(ids); err != nil {
		return nil, err
	}
	m.defaultTemplateIDs = append([]int64(nil), ids...)
	return append([]int64(nil), ids...), nil
}

func (m *memoryRepo) ApplyCommandTemplatesToAllItems(_ context.Context, templateIDs []int64) error {
	ids := dedupeTemplateIDs(templateIDs)
	if err := m.validateTemplateIDs(ids); err != nil {
		return err
	}
	for cardID, c := range m.cards {
		if !m.living(c) {
			continue
		}
		m.cardTemplateIDs[cardID] = append([]int64(nil), ids...)
	}
	return nil
}

func (m *memoryRepo) GetListFilter(context.Context) (WorkspaceListFilters, error) {
	if m.listFilter == nil {
		return defaultWorkspaceListFilters(m.columns), nil
	}
	return WorkspaceListFilters{
		Board:   cloneListFilter(m.listFilter.Board),
		Backlog: cloneListFilter(m.listFilter.Backlog),
	}, nil
}

func (m *memoryRepo) PutListFilter(_ context.Context, in WorkspaceListFilters) (WorkspaceListFilters, error) {
	known := make(map[int64]struct{}, len(m.columns))
	for _, c := range m.columns {
		known[c.ID] = struct{}{}
	}
	out := WorkspaceListFilters{
		Board:   normalizeListFilter(in.Board, known),
		Backlog: normalizeListFilter(in.Backlog, known),
	}
	cp := WorkspaceListFilters{
		Board:   cloneListFilter(out.Board),
		Backlog: cloneListFilter(out.Backlog),
	}
	m.listFilter = &cp
	return out, nil
}

func (m *memoryRepo) GetHeaderMenu(context.Context) (WorkspaceHeaderMenu, error) {
	if m.headerMenu == nil {
		return emptyWorkspaceHeaderMenu(), nil
	}
	return cloneWorkspaceHeaderMenu(*m.headerMenu), nil
}

func (m *memoryRepo) PutHeaderMenu(_ context.Context, in WorkspaceHeaderMenu) (WorkspaceHeaderMenu, error) {
	out := WorkspaceHeaderMenu{
		Board:      normalizePageHeaderMenuPut(in.Board),
		Backlog:    normalizePageHeaderMenuPut(in.Backlog),
		ItemDetail: normalizePageHeaderMenuPut(in.ItemDetail),
	}
	cp := cloneWorkspaceHeaderMenu(out)
	m.headerMenu = &cp
	return out, nil
}

func (m *memoryRepo) ListComments(_ context.Context, itemID int64) ([]Comment, error) {
	out := make([]Comment, 0)
	for _, c := range m.comments {
		if c.ItemID == itemID {
			out = append(out, c)
		}
	}
	slices.SortFunc(out, func(a, b Comment) int {
		if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return out, nil
}

func (m *memoryRepo) GetComment(_ context.Context, itemID, commentID int64) (Comment, error) {
	c, ok := m.comments[commentID]
	if !ok || c.ItemID != itemID {
		return Comment{}, ErrNotFound
	}
	return c, nil
}

func (m *memoryRepo) CreateComment(_ context.Context, itemID int64, author, body string, createdByUserID int64) (Comment, error) {
	c0, ok := m.cards[itemID]
	if !ok || !m.living(c0) {
		return Comment{}, ErrNotFound
	}
	now := time.Now().UTC()
	id := m.nextCommentID
	m.nextCommentID++
	uid := createdByUserID
	c := Comment{ID: id, ItemID: itemID, Author: author, Body: body, CreatedByUserID: &uid, CreatedAt: now, UpdatedAt: now}
	m.comments[id] = c
	return c, nil
}

func (m *memoryRepo) UpdateComment(_ context.Context, itemID, commentID int64, body *string) (Comment, error) {
	c, ok := m.comments[commentID]
	if !ok || c.ItemID != itemID {
		return Comment{}, ErrNotFound
	}
	if body != nil {
		c.Body = *body
	}
	c.UpdatedAt = time.Now().UTC()
	m.comments[commentID] = c
	return c, nil
}

func (m *memoryRepo) DeleteComment(_ context.Context, itemID, commentID int64) error {
	c, ok := m.comments[commentID]
	if !ok || c.ItemID != itemID {
		return ErrNotFound
	}
	delete(m.comments, commentID)
	return nil
}

func (m *memoryRepo) ListAIMessages(_ context.Context, itemID int64) ([]AIMessage, error) {
	out := make([]AIMessage, 0)
	for _, msg := range m.aiMessages {
		if msg.ItemID == itemID {
			out = append(out, msg)
		}
	}
	slices.SortFunc(out, func(a, b AIMessage) int {
		if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return out, nil
}

func (m *memoryRepo) AppendAITurn(_ context.Context, itemID int64, userBody, assistantBody string, inTok, outTok int64) error {
	c0, ok := m.cards[itemID]
	if !ok || !m.living(c0) {
		return ErrNotFound
	}
	existing, _ := m.ListAIMessages(context.Background(), itemID)
	overflow := len(existing) + 2 - maxAIChatStoredMessages
	if overflow > 0 {
		for i := 0; i < overflow; i++ {
			delete(m.aiMessages, existing[i].ID)
		}
	}
	now := time.Now().UTC()
	uid := m.nextAIMessageID
	m.nextAIMessageID++
	m.aiMessages[uid] = AIMessage{ID: uid, ItemID: itemID, Role: AIRoleUser, Body: userBody, CreatedAt: now}
	aid := m.nextAIMessageID
	m.nextAIMessageID++
	asst := AIMessage{ID: aid, ItemID: itemID, Role: AIRoleAssistant, Body: assistantBody, CreatedAt: now.Add(time.Nanosecond)}
	if inTok > 0 {
		v := int(inTok)
		asst.InputTokens = &v
	}
	if outTok > 0 {
		v := int(outTok)
		asst.OutputTokens = &v
	}
	m.aiMessages[aid] = asst
	return nil
}

func (m *memoryRepo) ClearAIMessages(_ context.Context, itemID int64) error {
	for id, msg := range m.aiMessages {
		if msg.ItemID == itemID {
			delete(m.aiMessages, id)
		}
	}
	return nil
}

func (m *memoryRepo) AddAIUsage(_ context.Context, requests, inTok, outTok int64) error {
	m.aiUsage.RequestCount += requests
	m.aiUsage.InputTokens += inTok
	m.aiUsage.OutputTokens += outTok
	return nil
}

func (m *memoryRepo) GetAIUsage(context.Context) (AIUsage, error) {
	out := m.aiUsage
	if m.aiUsage.LimitTokens != nil {
		v := *m.aiUsage.LimitTokens
		out.LimitTokens = &v
	}
	return out, nil
}

func (m *memoryRepo) SetAICreditLimit(_ context.Context, limit *int64) error {
	if limit != nil && *limit < 0 {
		return fmt.Errorf("negative limit")
	}
	if limit == nil {
		m.aiUsage.LimitTokens = nil
		return nil
	}
	v := *limit
	m.aiUsage.LimitTokens = &v
	return nil
}

// projectId を省略した番号指定の API は、アクティブなプロジェクトを調べるためにボード全件を読まない。
func TestByNumberWithoutProjectIDDoesNotReadWholeBoard(t *testing.T) {
	repo := fresh()
	repo.cards[18] = Item{ID: 18, Number: 3, ColumnID: 1, Title: "number three"}
	h := NewHandler(repo)
	boardBefore := repo.boardCalls.Load()
	w := request(h, "GET", "/api/items/by-number/3", "")
	if w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body)
	}
	if repo.activeIDCalls.Load() == 0 {
		t.Fatal("ActiveProjectID was not used to resolve the active project")
	}
	if got := repo.boardCalls.Load() - boardBefore; got != 0 {
		t.Fatalf("Board was read %d times", got)
	}
}

func TestListResponsesTrimDescriptionAndDropSolution(t *testing.T) {
	long := strings.Repeat("あ", listDescriptionRunes+50)
	repo := fresh()
	repo.cards[18] = Item{ID: 18, Number: 3, ColumnID: 1, Title: "long", Description: long, Solution: "sol"}
	h := NewHandler(repo)
	for _, path := range []string{"/api/board", "/api/backlog"} {
		w := request(h, "GET", path, "")
		if w.Code != 200 {
			t.Fatalf("%s status=%d %s", path, w.Code, w.Body)
		}
		var resp struct {
			Items []Item `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		items := resp.Items
		var got *Item
		for i := range items {
			if items[i].ID == 18 {
				got = &items[i]
			}
		}
		if got == nil {
			t.Fatalf("%s: item 18 missing", path)
		}
		if n := len([]rune(got.Description)); n != listDescriptionRunes {
			t.Fatalf("%s: description runes=%d", path, n)
		}
		if got.Solution != "" {
			t.Fatalf("%s: solution=%q", path, got.Solution)
		}
	}
	w := request(h, "GET", "/api/items/by-number/3", "")
	var full Item
	if err := json.Unmarshal(w.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	if full.Description != long || full.Solution != "sol" {
		t.Fatalf("detail is trimmed: desc runes=%d solution=%q", len([]rune(full.Description)), full.Solution)
	}
}

func TestCardListFieldsDifferFromCardFieldsOnlyInDescriptionAndSolution(t *testing.T) {
	want := strings.Replace(cardFields, "c.description, c.solution", fmt.Sprintf("LEFT(c.description, %d), ''", listDescriptionRunes), 1)
	if cardListFields != want {
		t.Fatalf("cardListFields drifted from cardFields:\n got=%s\nwant=%s", cardListFields, want)
	}
}

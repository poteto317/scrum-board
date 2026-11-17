package kanban

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound          = errors.New("not found")
	ErrColumn            = errors.New("unknown column")
	ErrDuplicate         = errors.New("duplicate column")
	ErrColumnOrder       = errors.New("invalid column order")
	ErrColumnMismatch    = errors.New("column set mismatch")
	ErrItemOrder         = errors.New("invalid item order")
	ErrItemOrderMismatch = errors.New("item set mismatch")
	ErrBacklogOrder      = errors.New("invalid backlog order")
	ErrBacklogMismatch   = errors.New("backlog set mismatch")
	ErrBoardSettings     = errors.New("invalid board settings")
	ErrProject           = errors.New("invalid project")
	ErrProjectConflict   = errors.New("project conflict")
)

const (
	CardLayoutPack = "pack"
	CardLayoutFree = "free"
	// MaxOffsetY is the inclusive upper bound for free-layout offsetY / offsetYs (CSS px).
	// Values above this are rejected with HTTP 400 on PUT /api/items/order.
	MaxOffsetY = 100_000
	// freePlacementStepY is the approximate vertical gap used when placing a new/moved
	// card at the bottom of a free-layout column (server has no DOM heights).
	freePlacementStepY = 160
)

type Column struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}
type Project struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Item struct {
	Number          int64         `json:"number"`
	ID              int64         `json:"id"`
	ColumnID        int64         `json:"columnId"`
	ProjectID       int64         `json:"projectId"`
	Title           string        `json:"title"`
	Description     string        `json:"description"`
	Position        int           `json:"position"`
	OffsetY         int           `json:"offsetY"`
	BacklogPosition int           `json:"backlogPosition"`
	PRURLs          []string      `json:"prUrls"`
	PRTitles        []string      `json:"prTitles"`
	RelatedItems    []RelatedItem `json:"relatedItems"`
	Assignee        string        `json:"assignee"`
	CloseReason     string        `json:"closeReason"`
	DueAt           *time.Time    `json:"dueAt"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

type ItemColumnOrder struct {
	ColumnID int64   `json:"columnId"`
	ItemIDs  []int64 `json:"itemIds"`
	OffsetYs *[]int  `json:"offsetYs,omitempty"`
}
type BoardSettings struct {
	CardLayout          string `json:"cardLayout"`
	MobileBoardColumnID int64  `json:"mobileBoardColumnId"`
	ActiveProjectID     int64  `json:"activeProjectId"`
}
type Board struct {
	Columns  []Column      `json:"columns"`
	Items    []Item        `json:"items"`
	Settings BoardSettings `json:"settings"`
}
type ItemInput struct {
	ColumnID     int64         `json:"columnId"`
	ProjectID    *int64        `json:"projectId,omitempty"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	PRURLs       []string      `json:"prUrls"`
	RelatedItems []RelatedItem `json:"relatedItems"`
	Assignee     string        `json:"assignee"`
	CloseReason  string        `json:"closeReason"`
}
type ItemPatch struct {
	ColumnID     *int64         `json:"columnId"`
	ProjectID    *int64         `json:"projectId,omitempty"`
	Title        *string        `json:"title"`
	Description  *string        `json:"description"`
	PRURLs       *[]string      `json:"prUrls"`
	RelatedItems *[]RelatedItem `json:"relatedItems"`
	Assignee     *string        `json:"assignee"`
	CloseReason  *string        `json:"closeReason"`
	DueAt        *time.Time     `json:"dueAt"`
	ClearDueAt   bool           `json:"-"`
}

// Repository keeps HTTP independent of MySQL, so handlers can be tested without a database.
type Repository interface {
	Board(context.Context) (Board, error)
	ListProjects(context.Context) ([]Project, error)
	CreateProject(context.Context, string) (Project, error)
	UpdateProject(context.Context, int64, string) (Project, error)
	DeleteProject(context.Context, int64) error
	UpdateBoardSettings(context.Context, BoardSettings) (BoardSettings, []Item, error)
	PatchBoardSettings(context.Context, BoardSettingsPatch) (BoardSettings, []Item, error)
	History(context.Context, int64, int64, int64) (HistoryPage, error)
	GetItem(context.Context, int64) (Item, error)
	GetItemByNumber(context.Context, int64, int64) (Item, error)
	GetColumnByName(context.Context, string) (Column, error)
	CreateItem(context.Context, ItemInput) (Item, error)
	UpdateItem(context.Context, int64, ItemPatch) (Item, error)
	DeleteItem(context.Context, int64) error
	CreateColumn(context.Context, string) (Column, error)
	ReorderColumns(context.Context, []int64) ([]Column, error)
	ReorderItems(context.Context, []ItemColumnOrder) ([]Item, error)
	Backlog(context.Context) ([]Item, error)
	ReorderBacklog(context.Context, []int64) ([]Item, error)
	ListCommandTemplates(context.Context) ([]CommandTemplate, error)
	CreateCommandTemplate(context.Context, CommandTemplateInput) (CommandTemplate, error)
	UpdateCommandTemplate(context.Context, int64, CommandTemplatePatch) (CommandTemplate, error)
	DeleteCommandTemplate(context.Context, int64) error
	ListItemCommandTemplates(context.Context, int64) ([]CommandTemplate, error)
	ReplaceItemCommandTemplates(context.Context, int64, []int64) ([]CommandTemplate, error)
	ListCommandTemplateDefaults(context.Context) ([]int64, error)
	ReplaceCommandTemplateDefaults(context.Context, []int64) ([]int64, error)
	ApplyCommandTemplatesToAllItems(context.Context, []int64) error
	GetListFilter(context.Context) (ListFilter, error)
	PutListFilter(context.Context, ListFilter) (ListFilter, error)
}

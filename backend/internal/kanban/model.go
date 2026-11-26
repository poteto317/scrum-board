package kanban

import (
	"context"
	"errors"
	"io"
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
	ErrProjectOrder      = errors.New("invalid project order")
	ErrProjectMismatch   = errors.New("project set mismatch")
	ErrSprint            = errors.New("invalid sprint")
	ErrSprintConflict    = errors.New("sprint conflict")
	ErrRecurring         = errors.New("invalid recurring rule")
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
	Solution        string        `json:"solution"`
	Position        int           `json:"position"`
	OffsetY         int           `json:"offsetY"`
	BacklogPosition int           `json:"backlogPosition"`
	PRURLs          []string      `json:"prUrls"`
	PRTitles        []string      `json:"prTitles"`
	RelatedItems    []RelatedItem `json:"relatedItems"`
	Assignee        string        `json:"assignee"`
	CloseReason     string        `json:"closeReason"`
	Favorite        bool          `json:"favorite"`
	DueAt           *time.Time    `json:"dueAt"`
	DoneAt          *time.Time    `json:"doneAt,omitempty"`
	ArchivedAt      *time.Time    `json:"archivedAt,omitempty"`
	DeletedAt       *time.Time    `json:"deletedAt,omitempty"`
	ViewAccess      string        `json:"viewAccess"`
	EditAccess      string        `json:"editAccess"`
	CreatedByUserID *int64        `json:"createdByUserId"`
	// ViewerCanEdit / ViewerCanManage are for the request user (FE form guard). Set on detail replies; omitempty hides false on lists.
	ViewerCanEdit   bool `json:"canEdit,omitempty"`
	ViewerCanManage bool `json:"canManage,omitempty"`
	// ACL is omitempty: only set for manage-capable responses.
	ACL       *ItemACL  `json:"acl,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// TrashItem is one soft-deleted card for the trash list API.
type TrashItem struct {
	ID        int64     `json:"id"`
	Number    int64     `json:"number"`
	Title     string    `json:"title"`
	ProjectID int64     `json:"projectId"`
	DeletedAt time.Time `json:"deletedAt"`
}

// TrashEntry is a trash row with the access policy needed to decide who may see it, so the
// list can be filtered without loading each item again.
type TrashEntry struct {
	TrashItem
	ACL ItemACLState
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

// BoardMeta is Board without items: columns and resolved settings only (GET /api/board/meta).
type BoardMeta struct {
	Columns  []Column      `json:"columns"`
	Settings BoardSettings `json:"settings"`
}
type ItemInput struct {
	ColumnID     int64         `json:"columnId"`
	ProjectID    *int64        `json:"projectId,omitempty"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	Solution     string        `json:"solution"`
	PRURLs       []string      `json:"prUrls"`
	RelatedItems []RelatedItem `json:"relatedItems"`
	Assignee     string        `json:"assignee"`
	CloseReason  string        `json:"closeReason"`
	Favorite     bool          `json:"favorite"`
	// CreatedByUserID is set by the handler from the session; never from JSON.
	CreatedByUserID *int64 `json:"-"`
}
type ItemPatch struct {
	ColumnID     *int64         `json:"columnId"`
	ProjectID    *int64         `json:"projectId,omitempty"`
	Title        *string        `json:"title"`
	Description  *string        `json:"description"`
	Solution     *string        `json:"solution"`
	PRURLs       *[]string      `json:"prUrls"`
	RelatedItems *[]RelatedItem `json:"relatedItems"`
	Assignee     *string        `json:"assignee"`
	CloseReason  *string        `json:"closeReason"`
	Favorite     *bool          `json:"favorite"`
	DueAt        *time.Time     `json:"dueAt"`
	ClearDueAt   bool           `json:"-"`
	// ACL fields on general PATCH are rejected by the handler (dedicated /acl API).
	ViewAccess      *string  `json:"viewAccess"`
	EditAccess      *string  `json:"editAccess"`
	ViewUserIDs     *[]int64 `json:"viewUserIds"`
	EditUserIDs     *[]int64 `json:"editUserIds"`
	ACL             *ItemACL `json:"acl"`
	CreatedByUserID *int64   `json:"createdByUserId"`
}

type SprintStatus string

const (
	SprintStatusPlanned   SprintStatus = "planned"
	SprintStatusActive    SprintStatus = "active"
	SprintStatusCompleted SprintStatus = "completed"
)

// Sprint is the API shape for sprint detail (and list when Items/SuggestedVelocity may be zeroed).
type Sprint struct {
	ID                int64        `json:"id"`
	ProjectID         int64        `json:"projectId"`
	Name              string       `json:"name"`
	Goal              string       `json:"goal"`
	StartDate         string       `json:"startDate"` // YYYY-MM-DD
	EndDate           string       `json:"endDate"`
	Status            SprintStatus `json:"status"`
	Velocity          *int         `json:"velocity"`
	SuggestedVelocity int          `json:"suggestedVelocity,omitempty"`
	ItemCount         int          `json:"itemCount"`
	Items             []SprintItem `json:"items,omitempty"`
	CreatedAt         time.Time    `json:"createdAt"`
	UpdatedAt         time.Time    `json:"updatedAt"`
}

type SprintItem struct {
	ID       int64  `json:"id"`
	Number   int64  `json:"number"`
	Title    string `json:"title"`
	ColumnID int64  `json:"columnId"`
	// What deciding who may see the member takes. Read together with the member (sprintMemberColumns)
	// and never serialised; build a SprintItem anywhere else and these are empty, which reads as
	// "no restriction" — so do not.
	ViewAccess      string `json:"-"`
	EditAccess      string `json:"-"`
	CreatedByUserID *int64 `json:"-"`
}

type SprintCreateInput struct {
	Name      string
	Goal      string
	StartDate string
	EndDate   string
	ProjectID int64
}

// SprintPatch uses Velocity + ClearVelocity like ItemPatch.DueAt (L-002). Never **int.
type SprintPatch struct {
	Name          *string
	Goal          *string
	StartDate     *string
	EndDate       *string
	Velocity      *int
	ClearVelocity bool
}

// Repository keeps HTTP independent of MySQL, so handlers can be tested without a database.
type Repository interface {
	Board(context.Context) (Board, error)
	// BoardMeta returns the same columns and resolved settings as Board, without reading items.
	BoardMeta(context.Context) (BoardMeta, error)
	// ActiveProjectID returns the resolved active project id (same rule as Board's
	// settings.activeProjectId) reading only settings and projects, not columns or items.
	ActiveProjectID(context.Context) (int64, error)
	// Columns returns the ordered columns (same as Board's columns) without reading settings, projects or items.
	Columns(context.Context) ([]Column, error)
	// BoardForProject returns the same columns/settings as Board (active unchanged in settings),
	// but items belong to projectID. projectID must exist; otherwise ErrProject.
	BoardForProject(context.Context, int64) (Board, error)
	ListProjects(context.Context) ([]Project, error)
	CreateProject(context.Context, string) (Project, error)
	UpdateProject(context.Context, int64, string) (Project, error)
	DeleteProject(context.Context, int64) error
	ReorderProjects(context.Context, []int64) ([]Project, error)
	UpdateBoardSettings(context.Context, BoardSettings) (BoardSettings, []Item, error)
	PatchBoardSettings(context.Context, BoardSettingsPatch) (BoardSettings, []Item, error)
	History(context.Context, int64, int64, int64) (HistoryPage, error)
	GetItem(context.Context, int64) (Item, error)
	GetItemByNumber(context.Context, int64, int64) (Item, error)
	// UserCanResolvePRURL is true when prURL is stored on an item (pr link or history evidence) the user may view.
	UserCanResolvePRURL(context.Context, *User, string) (bool, error)
	GetDeletedItem(context.Context, int64, int64) (Item, error)
	GetColumnByName(context.Context, string) (Column, error)
	CreateItem(context.Context, ItemInput) (Item, error)
	UpdateItem(context.Context, int64, ItemPatch) (Item, error)
	DeleteItem(context.Context, int64) error
	HardDeleteItem(context.Context, int64) error
	HardDeleteTrashItem(context.Context, int64, int64) error
	ListTrash(context.Context, int64) ([]TrashEntry, error)
	RestoreItem(context.Context, int64, int64) (Item, error)
	PurgeExpiredTrash(context.Context) (int64, error)
	CreateColumn(context.Context, string) (Column, error)
	ReorderColumns(context.Context, []int64) ([]Column, error)
	ReorderItems(context.Context, []ItemColumnOrder) ([]Item, error)
	Backlog(context.Context) ([]Item, error)
	// BacklogForProject lists living backlog items for projectID without changing active.
	BacklogForProject(context.Context, int64) ([]Item, error)
	ReorderBacklog(context.Context, []int64) ([]Item, error)
	ListLivingItems(context.Context) ([]Item, error)
	ListCommandTemplates(context.Context) ([]CommandTemplate, error)
	CreateCommandTemplate(context.Context, CommandTemplateInput) (CommandTemplate, error)
	UpdateCommandTemplate(context.Context, int64, CommandTemplatePatch) (CommandTemplate, error)
	DeleteCommandTemplate(context.Context, int64) error
	ListItemCommandTemplates(context.Context, int64) ([]CommandTemplate, error)
	ReplaceItemCommandTemplates(context.Context, int64, []int64) ([]CommandTemplate, error)
	ListCommandTemplateDefaults(context.Context) ([]int64, error)
	ReplaceCommandTemplateDefaults(context.Context, []int64) ([]int64, error)
	ApplyCommandTemplatesToAllItems(context.Context, []int64) error
	GetListFilter(context.Context) (WorkspaceListFilters, error)
	PutListFilter(context.Context, WorkspaceListFilters) (WorkspaceListFilters, error)
	GetHeaderMenu(context.Context) (WorkspaceHeaderMenu, error)
	PutHeaderMenu(context.Context, WorkspaceHeaderMenu) (WorkspaceHeaderMenu, error)
	ListComments(context.Context, int64) ([]Comment, error)
	GetComment(context.Context, int64, int64) (Comment, error)
	CreateComment(context.Context, int64, string, string, int64) (Comment, error)
	UpdateComment(context.Context, int64, int64, *string) (Comment, error)
	DeleteComment(context.Context, int64, int64) error
	ListAIMessages(context.Context, int64) ([]AIMessage, error)
	AppendAITurn(ctx context.Context, itemID int64, userBody, assistantBody string, inTok, outTok int64) error
	ClearAIMessages(context.Context, int64) error
	// Project chat history is kept in conversations that belong to one project × user. Every one
	// of these is narrowed by project and user (and the conversation, where one is named): they
	// never touch another user's or project's conversations or messages.
	// ListProjectAIConversations: newest update first (same time: larger id first), at most 100.
	ListProjectAIConversations(ctx context.Context, projectID, userID int64) ([]ProjectAIConversation, error)
	// GetProjectAIConversation: ErrNotFound when it is missing, another user's or another project's.
	GetProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) (ProjectAIConversation, error)
	// LatestProjectAIConversation: the first of the list, nil when there is none.
	LatestProjectAIConversation(ctx context.Context, projectID, userID int64) (*ProjectAIConversation, error)
	ListProjectAIMessages(ctx context.Context, projectID, userID, conversationID int64) ([]ProjectAIMessage, error)
	// AppendProjectAITurn stores one exchange in the conversation and returns that conversation.
	// With a nil conversationID, or when that conversation is gone, it creates one named turn.Title
	// (and then keeps the 100 most recently updated). A conversation keeps its newest 200 messages.
	AppendProjectAITurn(ctx context.Context, projectID, userID int64, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error)
	// DeleteProjectAIConversation: ErrNotFound when it is missing, another user's or another project's.
	DeleteProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) error
	// ClearProjectAIConversations deletes all of the user's conversations in the project.
	ClearProjectAIConversations(ctx context.Context, projectID, userID int64) error
	// SearchProjectItems filters and orders the project's items (trash excluded, archive included) that
	// search.Viewer may view (same meaning as CanView), and returns at most 201.
	SearchProjectItems(ctx context.Context, projectID int64, search ItemSearch) ([]Item, error)
	AddAIUsage(ctx context.Context, requests, inTok, outTok int64) error
	GetAIUsage(context.Context) (AIUsage, error)
	SetAICreditLimit(ctx context.Context, limit *int64) error
	ListAttachments(context.Context, int64) ([]Attachment, error)
	CreateAttachment(ctx context.Context, blobs BlobStorage, itemID int64, field string, commentID *int64, name, contentType string, size int64, body io.Reader, userID *int64) (Attachment, error)
	GetAttachment(ctx context.Context, itemID, id int64) (Attachment, error)
	OpenAttachmentContent(ctx context.Context, blobs BlobStorage, itemID, id int64) (io.ReadCloser, string, error)
	DeleteAttachment(ctx context.Context, blobs BlobStorage, itemID, attachmentID, itemNumber int64) error
	ListAttachmentObjectKeysByItemID(context.Context, int64) ([]string, error)
	ListAttachmentObjectKeysByCommentID(context.Context, int64) ([]string, error)
	ListAttachmentObjectKeysForExpiredTrash(ctx context.Context, projectID int64) ([]string, error)
	AttachmentObjectKeyExists(ctx context.Context, objectKey string) (bool, error)
	CountUsers(context.Context) (int64, error)
	ListUsers(context.Context) ([]User, error)
	GetUser(context.Context, int64) (User, error)
	GetUserByLoginName(context.Context, string) (User, error)
	CreateUser(context.Context, UserCreateInput) (User, error)
	UpdateUser(context.Context, int64, UserPatch, int64) (User, error)
	CountEnabledAdmins(context.Context) (int64, error)
	CreateSession(context.Context, int64, time.Time) (Session, error)
	DeleteSession(context.Context, string) error
	DeleteSessionsForUser(context.Context, int64) error
	UserBySessionID(context.Context, string, time.Time) (User, error)
	ListACLEntriesForItems(context.Context, []int64) (map[int64]ItemACL, error)
	ReplaceItemACL(context.Context, int64, string, string, []int64, []int64) (Item, error)
	ListSprints(context.Context, int64) ([]Sprint, error)
	GetSprint(context.Context, int64) (Sprint, error)
	CreateSprint(context.Context, SprintCreateInput) (Sprint, error)
	UpdateSprint(context.Context, int64, SprintPatch) (Sprint, error)
	DeleteSprint(context.Context, int64) error
	ReplaceSprintItems(context.Context, int64, []int64, []int64) (Sprint, error)
	ActivateSprint(context.Context, int64) (Sprint, error)
	CompleteSprint(context.Context, int64, *int) (Sprint, error)
	CountSprintsForProject(context.Context, int64) (int64, error)
	DeleteSprintItemsForItem(context.Context, int64) error
	ListRecurringRules(context.Context, int64) ([]RecurringRule, error)
	CreateRecurringRule(context.Context, int64, RecurringRuleInput) (RecurringRule, error)
	UpdateRecurringRule(context.Context, int64, int64, RecurringRulePatch) (RecurringRule, error)
	DeleteRecurringRule(context.Context, int64, int64) error
	RunRecurring(context.Context) (created, skipped, failed int, err error)
}

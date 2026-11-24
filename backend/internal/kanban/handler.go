package kanban

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type handler struct {
	repo              Repository
	formatter         ItemFormatter
	chatter           ItemChatter
	slots             chan struct{}
	publicOrigin      string
	prTitleResolver   *PRTitleResolver
	blobs             BlobStorage
	rateLimiter       AIRateLimiter
	loginAttempts     LoginAttemptLimiter
	messageMax        int
	historyTurns      int
	schedulerJobToken string
	attachmentSlots   chan struct{}
}

// Option customizes NewHandler without changing the call sites that only need the repository.
type Option func(*handler)

// WithItemFormatter enables POST /api/items/refined. A nil formatter keeps the endpoint answering 503.
func WithItemFormatter(f ItemFormatter) Option {
	return func(h *handler) { h.formatter = f }
}

// WithAIChat enables POST /api/items/.../ai-chat. A nil chatter keeps that POST answering 503.
func WithAIChat(c ItemChatter) Option {
	return func(h *handler) { h.chatter = c }
}

// WithPublicOrigin sets the canonical public origin for GET /api/public-config (already normalized).
func WithPublicOrigin(origin string) Option {
	return func(h *handler) { h.publicOrigin = NormalizePublicOrigin(origin) }
}

// WithPRTitleResolver injects PR title resolution for tests; production uses GitHub with optional GITHUB_TOKEN.
func WithPRTitleResolver(r *PRTitleResolver) Option {
	return func(h *handler) { h.prTitleResolver = r }
}

// WithBlobStorage injects attachment object storage (Memory in tests, GCS in production).
func WithBlobStorage(store BlobStorage) Option {
	return func(h *handler) { h.blobs = store }
}

// WithAILimits applies message/history caps and installs a sliding rate limiter from RatePerMinute (0 = off).
// ChatMaxOutputTokens is applied by wiring at aichat.New, not here (handler does not own the chatter client).
// If both WithAILimits and WithAIRateLimiter are used, pass WithAIRateLimiter after this so the custom limiter wins.
func WithAILimits(l AILimits) Option {
	return func(h *handler) {
		if l.MessageMax >= 1 {
			h.messageMax = l.MessageMax
		}
		if l.HistoryTurns >= 1 {
			h.historyTurns = l.HistoryTurns
		}
		h.rateLimiter = NewSlidingAIRateLimiter(l.RatePerMinute)
	}
}

// WithAIRateLimiter injects a custom limiter (tests). Nil keeps the current limiter.
// Place after WithAILimits when both are used.
func WithAIRateLimiter(l AIRateLimiter) Option {
	return func(h *handler) {
		if l != nil {
			h.rateLimiter = l
		}
	}
}

// WithLoginAttemptLimiter injects a custom login failure limiter (tests). Nil keeps the current limiter.
func WithLoginAttemptLimiter(l LoginAttemptLimiter) Option {
	return func(h *handler) {
		if l != nil {
			h.loginAttempts = l
		}
	}
}

// WithSchedulerJobToken sets the shared secret for Cloud Scheduler job POSTs (X-Scheduler-Token).
func WithSchedulerJobToken(token string) Option {
	return func(h *handler) { h.schedulerJobToken = token }
}

// WithAttachmentConcurrency caps concurrent attachment upload/content handlers (tests). n < 1 uses attachmentMaxConcurrent.
func WithAttachmentConcurrency(n int) Option {
	return func(h *handler) {
		if n < 1 {
			n = attachmentMaxConcurrent
		}
		h.attachmentSlots = make(chan struct{}, n)
	}
}

func NewHandler(repo Repository, opts ...Option) http.Handler {
	h := handler{
		repo:              repo,
		slots:             make(chan struct{}, maxConcurrentFormats),
		blobs:             UnavailableBlobStorage{},
		rateLimiter:       NewNoopAIRateLimiter(),
		loginAttempts:     NewMemoryLoginAttemptLimiter(),
		messageMax:        maxAIChatMessageLen,
		historyTurns:      maxAIChatHistoryTurns,
		schedulerJobToken: HandlerTestSchedulerToken,
		attachmentSlots:   make(chan struct{}, attachmentMaxConcurrent),
		// prTitleResolver nil by default so unit tests do not hit GitHub; wire in production via WithPRTitleResolver.
	}
	for _, opt := range opts {
		opt(&h)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/public-config", h.publicConfig)
	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	mux.HandleFunc("GET /api/auth/me", h.me)
	mux.HandleFunc("GET /api/users", h.listUsers)
	mux.HandleFunc("POST /api/users", h.createUser)
	mux.HandleFunc("PATCH /api/users/{id}", h.patchUser)
	mux.HandleFunc("GET /api/board", h.board)
	mux.HandleFunc("GET /api/board/meta", h.boardMeta)
	mux.HandleFunc("PATCH /api/board/settings", h.updateBoardSettings)
	mux.HandleFunc("GET /api/projects", h.listProjects)
	mux.HandleFunc("POST /api/projects", h.createProject)
	mux.HandleFunc("PATCH /api/projects/{id}", h.updateProject)
	mux.HandleFunc("DELETE /api/projects/{id}", h.deleteProject)
	mux.HandleFunc("PUT /api/projects/order", h.reorderProjects)
	mux.HandleFunc("GET /api/sprints", h.listSprints)
	mux.HandleFunc("POST /api/sprints", h.createSprint)
	mux.HandleFunc("GET /api/sprints/{id}", h.getSprint)
	mux.HandleFunc("PATCH /api/sprints/{id}", h.updateSprint)
	mux.HandleFunc("DELETE /api/sprints/{id}", h.deleteSprint)
	mux.HandleFunc("PUT /api/sprints/{id}/items", h.replaceSprintItems)
	mux.HandleFunc("POST /api/sprints/{id}/activate", h.activateSprint)
	mux.HandleFunc("POST /api/sprints/{id}/complete", h.completeSprint)
	mux.HandleFunc("GET /api/backlog", h.backlog)
	mux.HandleFunc("PUT /api/backlog/order", h.reorderBacklog)
	mux.HandleFunc("GET /api/archive", h.listArchivedItems)
	mux.HandleFunc("POST /api/archive/auto-archive", h.autoArchive)
	mux.HandleFunc("GET /api/items/by-number/{number}/history", h.history)
	mux.HandleFunc("GET /api/items/by-number/{number}/comments", h.listComments)
	mux.HandleFunc("POST /api/items/by-number/{number}/comments", h.createComment)
	mux.HandleFunc("PATCH /api/items/by-number/{number}/comments/{id}", h.updateComment)
	mux.HandleFunc("DELETE /api/items/by-number/{number}/comments/{id}", h.deleteComment)
	mux.HandleFunc("GET /api/items/by-number/{number}/ai-chat", h.listAIChat)
	mux.HandleFunc("POST /api/items/by-number/{number}/ai-chat", h.postAIChat)
	mux.HandleFunc("DELETE /api/items/by-number/{number}/ai-chat", h.clearAIChat)
	mux.HandleFunc("GET /api/ai/usage", h.getAIUsage)
	mux.HandleFunc("GET /api/ai/credits", h.getAICredits)
	mux.HandleFunc("PUT /api/ai/credits", h.putAICredits)
	mux.HandleFunc("GET /api/items/by-number/{number}/attachments", h.listAttachments)
	mux.HandleFunc("POST /api/items/by-number/{number}/attachments", h.createAttachment)
	mux.HandleFunc("GET /api/items/by-number/{number}/attachments/{id}/content", h.getAttachmentContent)
	mux.HandleFunc("DELETE /api/items/by-number/{number}/attachments/{id}", h.deleteAttachment)
	mux.HandleFunc("POST /api/columns", h.createColumn)
	mux.HandleFunc("PUT /api/columns/order", h.reorderColumns)
	mux.HandleFunc("PUT /api/items/order", h.reorderItems)
	mux.HandleFunc("POST /api/items", h.createItem)
	mux.HandleFunc("POST /api/items/refined", h.createRefinedItem)
	mux.HandleFunc("GET /api/items/{id}", h.getItem)
	mux.HandleFunc("GET /api/items/by-number/{number}", h.getItemByNumber)
	mux.HandleFunc("PATCH /api/items/{id}", h.updateItem)
	mux.HandleFunc("PATCH /api/items/{id}/acl", h.patchItemACL)
	mux.HandleFunc("PATCH /api/items/by-number/{number}/status", h.changeStatusByNumber)
	mux.HandleFunc("PATCH /api/items/by-number/{number}/assignee", h.changeAssigneeByNumber)
	mux.HandleFunc("DELETE /api/items/{id}", h.deleteItem)
	mux.HandleFunc("POST /api/items/{id}/restore", h.restoreItem)
	mux.HandleFunc("POST /api/items/{id}/unarchive", h.restoreArchivedItem)
	mux.HandleFunc("GET /api/trash", h.listTrash)
	mux.HandleFunc("DELETE /api/trash/{id}", h.hardDeleteTrash)
	mux.HandleFunc("POST /api/trash/purge", h.purgeTrash)
	mux.HandleFunc("GET /api/recurring-rules", h.listRecurringRules)
	mux.HandleFunc("POST /api/recurring-rules", h.createRecurringRule)
	mux.HandleFunc("PATCH /api/recurring-rules/{id}", h.updateRecurringRule)
	mux.HandleFunc("DELETE /api/recurring-rules/{id}", h.deleteRecurringRule)
	mux.HandleFunc("POST /api/recurring/run", h.runRecurring)
	mux.HandleFunc("GET /api/command-templates", h.listCommandTemplates)
	mux.HandleFunc("POST /api/command-templates", h.createCommandTemplate)
	mux.HandleFunc("PATCH /api/command-templates/{id}", h.updateCommandTemplate)
	mux.HandleFunc("DELETE /api/command-templates/{id}", h.deleteCommandTemplate)
	mux.HandleFunc("POST /api/command-templates/apply-to-all-items", h.applyCommandTemplatesToAllItems)
	mux.HandleFunc("GET /api/command-template-defaults", h.listCommandTemplateDefaults)
	mux.HandleFunc("PUT /api/command-template-defaults", h.replaceCommandTemplateDefaults)
	// by-number only: GET /api/items/{id}/command-templates conflicts with GET /api/items/by-number/{number} in ServeMux.
	mux.HandleFunc("GET /api/items/by-number/{number}/command-templates", h.listItemCommandTemplatesByNumber)
	mux.HandleFunc("PUT /api/items/by-number/{number}/command-templates", h.replaceItemCommandTemplatesByNumber)
	mux.HandleFunc("POST /api/pr-titles", h.batchPRTitles)
	mux.HandleFunc("GET /api/list-filter", h.getListFilter)
	mux.HandleFunc("PUT /api/list-filter", h.putListFilter)
	mux.HandleFunc("GET /api/header-menu", h.getHeaderMenu)
	mux.HandleFunc("PUT /api/header-menu", h.putHeaderMenu)
	secured := h.withSessionAuth(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		secured.ServeHTTP(w, r)
	})
}
func (h handler) backlog(w http.ResponseWriter, r *http.Request) {
	cards, e := h.backlogForRequest(r)
	if e != nil {
		fail(w, e)
		return
	}
	userPtr := requestUserPtr(r)
	filtered, err := h.filterBoardItems(r.Context(), cards, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	replyJSONWithETag(w, r, map[string][]Item{"items": filtered})
}

func (h handler) reorderBacklog(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ItemIDs []int64 `json:"itemIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := validateBacklogOrder(in.ItemIDs); err != nil {
		fail(w, err)
		return
	}
	userPtr := requestUserPtr(r)
	expanded, submitted, err := h.expandBacklogWithHidden(r.Context(), in.ItemIDs, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	if !h.requireEditOnItemIDs(w, r, submitted) {
		return
	}
	cards, err := h.repo.ReorderBacklog(r.Context(), expanded)
	if err != nil {
		fail(w, err)
		return
	}
	filtered, err := h.filterBoardItems(r.Context(), cards, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Item{"items": filtered})
}

func (h handler) board(w http.ResponseWriter, r *http.Request) {
	b, e := h.boardForRequest(r)
	if e != nil {
		fail(w, e)
		return
	}
	userPtr := requestUserPtr(r)
	filtered, err := h.filterBoardItems(r.Context(), b.Items, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	b.Items = filtered
	replyJSONWithETag(w, r, b)
}

// boardMeta returns columns and resolved settings without items (no per-item ACL applies).
// projectId is intentionally not read: columns and settings do not depend on the project.
func (h handler) boardMeta(w http.ResponseWriter, r *http.Request) {
	meta, err := h.repo.BoardMeta(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	replyJSONWithETag(w, r, meta)
}

func (h handler) boardForRequest(r *http.Request) (Board, error) {
	pid, scoped, err := optionalQueryProjectID(r)
	if err != nil {
		return Board{}, err
	}
	if scoped {
		return h.repo.BoardForProject(r.Context(), pid)
	}
	return h.repo.Board(r.Context())
}

func (h handler) backlogForRequest(r *http.Request) ([]Item, error) {
	pid, scoped, err := optionalQueryProjectID(r)
	if err != nil {
		return nil, err
	}
	if scoped {
		return h.repo.BacklogForProject(r.Context(), pid)
	}
	return h.repo.Backlog(r.Context())
}

// optionalQueryProjectID parses ?projectId=. ok is false when the query is omitted.
func optionalQueryProjectID(r *http.Request) (projectID int64, ok bool, err error) {
	values, exists := r.URL.Query()["projectId"]
	if !exists {
		return 0, false, nil
	}
	if len(values) != 1 {
		return 0, false, ErrProject
	}
	pid, parseErr := strconv.ParseInt(values[0], 10, 64)
	if parseErr != nil || pid <= 0 {
		return 0, false, ErrProject
	}
	return pid, true, nil
}

func (h handler) updateBoardSettings(w http.ResponseWriter, r *http.Request) {
	var in BoardSettingsPatch
	if !decode(w, r, &in) {
		return
	}
	if in.CardLayout == nil && in.MobileBoardColumnID == nil && in.ActiveProjectID == nil {
		invalid(w, "cardLayout、mobileBoardColumnId、activeProjectId のいずれかを指定してください。")
		return
	}
	if in.CardLayout != nil {
		if *in.CardLayout != CardLayoutPack && *in.CardLayout != CardLayoutFree {
			invalid(w, "cardLayout は pack または free を指定してください。")
			return
		}
	}
	if in.MobileBoardColumnID != nil && *in.MobileBoardColumnID <= 0 {
		invalid(w, "mobileBoardColumnId は存在する列の ID を指定してください。")
		return
	}
	if in.ActiveProjectID != nil && *in.ActiveProjectID <= 0 {
		invalid(w, "activeProjectId は正のプロジェクト ID を指定してください。")
		return
	}
	settings, items, err := h.repo.PatchBoardSettings(r.Context(), in)
	if err != nil {
		fail(w, err)
		return
	}
	out := map[string]any{"settings": settings}
	if items != nil {
		filtered, ferr := h.filterBoardItems(r.Context(), items, requestUserPtr(r))
		if ferr != nil {
			fail(w, ferr)
			return
		}
		out["items"] = filtered
	}
	reply(w, 200, out)
}
func (h handler) getItem(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	c, e := h.repo.GetItem(r.Context(), n)
	if e != nil {
		fail(w, e)
		return
	}
	_, userPtr, okView := h.requireView(w, r, c)
	if !okView {
		return
	}
	if err := h.enrichItemForReply(r.Context(), &c, userPtr); err != nil {
		fail(w, err)
		return
	}
	attachPRTitles(r.Context(), h.prTitleResolver, &c)
	reply(w, 200, c)
}
func (h handler) activeProjectForByNumber(ctx context.Context) (int64, error) {
	board, err := h.repo.Board(ctx)
	if err != nil {
		return 0, err
	}
	projects, err := h.repo.ListProjects(ctx)
	if err != nil {
		return 0, err
	}
	return resolveActiveProjectID(board.Settings.ActiveProjectID, projects), nil
}

func (h handler) resolveByNumberProjectID(r *http.Request) (int64, error) {
	ctx := r.Context()
	if values, exists := r.URL.Query()["projectId"]; exists {
		if len(values) != 1 {
			return 0, ErrProject
		}
		pid, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || pid <= 0 {
			return 0, ErrProject
		}
		projects, err := h.repo.ListProjects(ctx)
		if err != nil {
			return 0, err
		}
		if !projectIDExists(projects, pid) {
			return 0, ErrProject
		}
		return pid, nil
	}
	return h.activeProjectForByNumber(ctx)
}

func (h handler) getItemByNumber(w http.ResponseWriter, r *http.Request) {
	n, ok := taskNumber(w, r)
	if !ok {
		return
	}
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	card, err := h.repo.GetItemByNumber(r.Context(), n, pid)
	if err != nil {
		fail(w, err)
		return
	}
	_, userPtr, okView := h.requireView(w, r, card)
	if !okView {
		return
	}
	if err := h.enrichItemForReply(r.Context(), &card, userPtr); err != nil {
		fail(w, err)
		return
	}
	attachPRTitles(r.Context(), h.prTitleResolver, &card)
	reply(w, 200, card)
}
func (h handler) batchPRTitles(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, http.StatusUnauthorized, map[string]string{"message": msgLoginRequired})
		return
	}
	userPtr := &user
	var in struct {
		URLs []string `json:"urls"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.URLs) > maxPRTitleBatch {
		invalid(w, "一度に解決できるPR URLは50件までです。")
		return
	}
	titles := make(map[string]string, len(in.URLs))
	for _, raw := range in.URLs {
		url := strings.TrimSpace(raw)
		if url == "" || !validPRURL(url) {
			continue
		}
		allowed, err := h.repo.UserCanResolvePRURL(r.Context(), userPtr, url)
		if err != nil {
			fail(w, err)
			return
		}
		if !allowed {
			titles[url] = FallbackPRTitle(url)
			continue
		}
		titles[url] = ResolvePRTitleLabel(r.Context(), h.prTitleResolver, url)
	}
	reply(w, 200, map[string]map[string]string{"titles": titles})
}
func (h handler) createColumn(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if !validColumnName(in.Name) {
		invalid(w, "列名は1〜60文字で入力してください。")
		return
	}
	c, e := h.repo.CreateColumn(r.Context(), in.Name)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 201, c)
}

func (h handler) reorderColumns(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ColumnIDs []int64 `json:"columnIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := validateColumnOrder(in.ColumnIDs); err != nil {
		fail(w, err)
		return
	}
	cols, err := h.repo.ReorderColumns(r.Context(), in.ColumnIDs)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Column{"columns": cols})
}

func (h handler) reorderItems(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Columns []ItemColumnOrder `json:"columns"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := validateItemOrder(in.Columns); err != nil {
		fail(w, err)
		return
	}
	userPtr := requestUserPtr(r)
	expanded, submitted, byID, err := h.expandItemOrdersWithHidden(r.Context(), in.Columns, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	if !h.requireEditOnLoadedItems(w, userPtr, byID, submitted) {
		return
	}
	cards, err := h.repo.ReorderItems(r.Context(), expanded)
	if err != nil {
		fail(w, err)
		return
	}
	filtered, err := h.filterBoardItems(r.Context(), cards, userPtr)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Item{"items": filtered})
}
func (h handler) createItem(w http.ResponseWriter, r *http.Request) {
	var in ItemInput
	if !decode(w, r, &in) {
		return
	}
	var valid bool
	in.PRURLs, valid = normalizePRURLs(in.PRURLs)
	if !valid {
		invalid(w, "GitHub PRのURLを入力してください。例: https://github.com/owner/repo/pull/1")
		return
	}
	in.RelatedItems, valid = normalizeRelatedItems(in.RelatedItems)
	if !valid {
		invalid(w, "関連の内容を確認してください（アイテム番号・URL・重複・自分自身は不可）。")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if !validTitle(in.Title) || !validDescription(in.Description) || in.ColumnID <= 0 {
		invalid(w, "タイトルは1〜200文字、説明は10000文字以内で入力し、ステータスを選んでください。")
		return
	}
	if in.ProjectID != nil && *in.ProjectID <= 0 {
		invalid(w, "プロジェクトを確認してください。")
		return
	}
	assignee, assigneeOK := NormalizeAssignee(in.Assignee)
	if !assigneeOK {
		invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
		return
	}
	in.Assignee = assignee
	closeReason, closeOK := NormalizeCloseReason(in.CloseReason)
	if !closeOK {
		invalid(w, "Close理由は2000文字以内で入力してください。")
		return
	}
	in.CloseReason = closeReason
	if !validDescription(in.Solution) {
		invalid(w, "ソリューションは10000文字以内で入力してください。")
		return
	}
	if !h.requireEditOnRelatedPeerDiff(w, r, nil, in.RelatedItems) {
		return
	}
	if u, ok := CurrentUser(r.Context()); ok {
		id := u.ID
		in.CreatedByUserID = &id
	}
	c, e := h.repo.CreateItem(r.Context(), in)
	if e != nil {
		fail(w, e)
		return
	}
	if err := h.enrichItemForReply(r.Context(), &c, requestUserPtr(r)); err != nil {
		fail(w, err)
		return
	}
	reply(w, 201, c)
}
func (h handler) updateItem(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	var body struct {
		ColumnID        *int64          `json:"columnId"`
		ProjectID       *int64          `json:"projectId"`
		Title           *string         `json:"title"`
		Description     *string         `json:"description"`
		Solution        *string         `json:"solution"`
		PRURLs          *[]string       `json:"prUrls"`
		RelatedItems    json.RawMessage `json:"relatedItems"`
		Assignee        json.RawMessage `json:"assignee"`
		CloseReason     json.RawMessage `json:"closeReason"`
		Favorite        json.RawMessage `json:"favorite"`
		DueAt           json.RawMessage `json:"dueAt"`
		ViewAccess      json.RawMessage `json:"viewAccess"`
		EditAccess      json.RawMessage `json:"editAccess"`
		ViewUserIDs     json.RawMessage `json:"viewUserIds"`
		EditUserIDs     json.RawMessage `json:"editUserIds"`
		ACL             json.RawMessage `json:"acl"`
		CreatedByUserID json.RawMessage `json:"createdByUserId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.ViewAccess) > 0 || len(body.EditAccess) > 0 || len(body.ViewUserIDs) > 0 ||
		len(body.EditUserIDs) > 0 || len(body.ACL) > 0 || len(body.CreatedByUserID) > 0 {
		invalid(w, "アクセス設定は専用 API で更新してください。")
		return
	}
	existing, err := h.repo.GetItem(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	if _, ok := h.requireActiveEdit(w, r, existing); !ok {
		return
	}
	p := ItemPatch{ColumnID: body.ColumnID, ProjectID: body.ProjectID, Title: body.Title, Description: body.Description, Solution: body.Solution, PRURLs: body.PRURLs}
	if len(body.RelatedItems) > 0 {
		if string(body.RelatedItems) == "null" {
			invalid(w, "関連の内容を確認してください（アイテム番号・URL・重複・自分自身は不可）。")
			return
		}
		var raw []RelatedItem
		if err := json.Unmarshal(body.RelatedItems, &raw); err != nil {
			invalid(w, "関連の内容を確認してください（アイテム番号・URL・重複・自分自身は不可）。")
			return
		}
		value, valid := normalizeRelatedItems(raw)
		if !valid {
			invalid(w, "関連の内容を確認してください（アイテム番号・URL・重複・自分自身は不可）。")
			return
		}
		if !h.requireEditOnRelatedPeerDiff(w, r, existing.RelatedItems, value) {
			return
		}
		p.RelatedItems = &value
	}
	if len(body.Assignee) > 0 {
		if string(body.Assignee) == "null" {
			invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
			return
		}
		var raw string
		if err := json.Unmarshal(body.Assignee, &raw); err != nil {
			invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
			return
		}
		value, valid := NormalizeAssignee(raw)
		if !valid {
			invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
			return
		}
		p.Assignee = &value
	}
	if len(body.CloseReason) > 0 && string(body.CloseReason) != "null" {
		var raw string
		if err := json.Unmarshal(body.CloseReason, &raw); err != nil {
			invalid(w, "Close理由は2000文字以内で入力してください。")
			return
		}
		value, valid := NormalizeCloseReason(raw)
		if !valid {
			invalid(w, "Close理由は2000文字以内で入力してください。")
			return
		}
		p.CloseReason = &value
	}
	if len(body.Favorite) > 0 {
		if string(body.Favorite) == "null" {
			invalid(w, "お気に入りは true または false で指定してください。")
			return
		}
		var value bool
		if err := json.Unmarshal(body.Favorite, &value); err != nil {
			invalid(w, "お気に入りは true または false で指定してください。")
			return
		}
		p.Favorite = &value
	}
	if len(body.DueAt) > 0 {
		if string(body.DueAt) == "null" {
			p.ClearDueAt = true
		} else {
			var raw string
			if err := json.Unmarshal(body.DueAt, &raw); err != nil {
				invalid(w, "期限はタイムゾーン付きの日時（例: 2026-11-17T08:30:00Z）で指定してください。")
				return
			}
			if raw == "" {
				invalid(w, "期限はタイムゾーン付きの日時（例: 2026-11-17T08:30:00Z）で指定してください。")
				return
			}
			value, err := NormalizeDueAt(raw)
			if err != nil {
				invalid(w, "期限はタイムゾーン付きの日時（例: 2026-11-17T08:30:00Z）で指定してください。")
				return
			}
			p.DueAt = &value
		}
	}
	if p.Title == nil && p.Description == nil && p.Solution == nil && p.ColumnID == nil && p.ProjectID == nil && p.PRURLs == nil && p.RelatedItems == nil && p.Assignee == nil && p.CloseReason == nil && p.Favorite == nil && p.DueAt == nil && !p.ClearDueAt {
		invalid(w, "変更するプロパティが必要です。")
		return
	}
	if p.PRURLs != nil {
		value, valid := normalizePRURLs(*p.PRURLs)
		if !valid {
			invalid(w, "GitHub PRのURLを入力してください。例: https://github.com/owner/repo/pull/1")
			return
		}
		p.PRURLs = &value
	}
	if p.Title != nil {
		*p.Title = strings.TrimSpace(*p.Title)
		if !validTitle(*p.Title) {
			invalid(w, "タイトルは1〜200文字で入力してください。")
			return
		}
	}
	if p.Description != nil && !validDescription(*p.Description) {
		invalid(w, "説明は10000文字以内で入力してください。")
		return
	}
	if p.Solution != nil && !validDescription(*p.Solution) {
		invalid(w, "ソリューションは10000文字以内で入力してください。")
		return
	}
	if p.ColumnID != nil && *p.ColumnID <= 0 {
		invalid(w, "ステータスを選んでください。")
		return
	}
	if p.ProjectID != nil && *p.ProjectID <= 0 {
		invalid(w, "プロジェクトを確認してください。")
		return
	}
	c, e := h.repo.UpdateItem(r.Context(), n, p)
	if e != nil {
		fail(w, e)
		return
	}
	if err := h.enrichItemForReply(r.Context(), &c, requestUserPtr(r)); err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, c)
}
func (h handler) deleteItem(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	existing, err := h.repo.GetItem(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	if _, ok := h.requireActiveEdit(w, r, existing); !ok {
		return
	}
	if e := h.repo.DeleteItem(r.Context(), n); e != nil {
		fail(w, e)
		return
	}
	w.WriteHeader(204)
}

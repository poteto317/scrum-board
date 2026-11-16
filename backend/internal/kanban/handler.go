package kanban

import (
	"encoding/json"
	"net/http"
	"strings"
)

type handler struct {
	repo            Repository
	formatter       ItemFormatter
	slots           chan struct{}
	publicOrigin    string
	prTitleResolver *PRTitleResolver
}

// Option customizes NewHandler without changing the call sites that only need the repository.
type Option func(*handler)

// WithItemFormatter enables POST /api/items/refined. A nil formatter keeps the endpoint answering 503.
func WithItemFormatter(f ItemFormatter) Option {
	return func(h *handler) { h.formatter = f }
}

// WithPublicOrigin sets the canonical public origin for GET /api/public-config (already normalized).
func WithPublicOrigin(origin string) Option {
	return func(h *handler) { h.publicOrigin = NormalizePublicOrigin(origin) }
}

// WithPRTitleResolver injects PR title resolution for tests; production uses GitHub with optional GITHUB_TOKEN.
func WithPRTitleResolver(r *PRTitleResolver) Option {
	return func(h *handler) { h.prTitleResolver = r }
}

func NewHandler(repo Repository, opts ...Option) http.Handler {
	h := handler{
		repo:            repo,
		slots:           make(chan struct{}, maxConcurrentFormats),
		prTitleResolver: NewPRTitleResolver(nil),
	}
	for _, opt := range opts {
		opt(&h)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/public-config", h.publicConfig)
	mux.HandleFunc("GET /api/board", h.board)
	mux.HandleFunc("GET /api/backlog", h.backlog)
	mux.HandleFunc("PUT /api/backlog/order", h.reorderBacklog)
	mux.HandleFunc("GET /api/items/by-number/{number}/history", h.history)
	mux.HandleFunc("POST /api/columns", h.createColumn)
	mux.HandleFunc("PUT /api/columns/order", h.reorderColumns)
	mux.HandleFunc("PUT /api/items/order", h.reorderItems)
	mux.HandleFunc("POST /api/items", h.createItem)
	mux.HandleFunc("POST /api/items/refined", h.createRefinedItem)
	mux.HandleFunc("GET /api/items/{id}", h.getItem)
	mux.HandleFunc("GET /api/items/by-number/{number}", h.getItemByNumber)
	mux.HandleFunc("PATCH /api/items/{id}", h.updateItem)
	mux.HandleFunc("PATCH /api/items/by-number/{number}/status", h.changeStatusByNumber)
	mux.HandleFunc("PATCH /api/items/by-number/{number}/assignee", h.changeAssigneeByNumber)
	mux.HandleFunc("DELETE /api/items/{id}", h.deleteItem)
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
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}
func (h handler) backlog(w http.ResponseWriter, r *http.Request) {
	cards, e := h.repo.Backlog(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string][]Item{"items": cards})
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
	cards, err := h.repo.ReorderBacklog(r.Context(), in.ItemIDs)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Item{"items": cards})
}

func (h handler) board(w http.ResponseWriter, r *http.Request) {
	b, e := h.repo.Board(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, b)
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
	attachPRTitles(r.Context(), h.prTitleResolver, &c)
	reply(w, 200, c)
}
func (h handler) getItemByNumber(w http.ResponseWriter, r *http.Request) {
	n, ok := taskNumber(w, r)
	if !ok {
		return
	}
	card, err := h.repo.GetItemByNumber(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	attachPRTitles(r.Context(), h.prTitleResolver, &card)
	reply(w, 200, card)
}
func (h handler) batchPRTitles(w http.ResponseWriter, r *http.Request) {
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
	cards, err := h.repo.ReorderItems(r.Context(), in.Columns)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Item{"items": cards})
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
	assignee, assigneeOK := NormalizeAssignee(in.Assignee)
	if !assigneeOK {
		invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
		return
	}
	in.Assignee = assignee
	c, e := h.repo.CreateItem(r.Context(), in)
	if e != nil {
		fail(w, e)
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
		ColumnID     *int64          `json:"columnId"`
		Title        *string         `json:"title"`
		Description  *string         `json:"description"`
		PRURLs       *[]string       `json:"prUrls"`
		RelatedItems json.RawMessage `json:"relatedItems"`
		Assignee     json.RawMessage `json:"assignee"`
	}
	if !decode(w, r, &body) {
		return
	}
	p := ItemPatch{ColumnID: body.ColumnID, Title: body.Title, Description: body.Description, PRURLs: body.PRURLs}
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
	if p.Title == nil && p.Description == nil && p.ColumnID == nil && p.PRURLs == nil && p.RelatedItems == nil && p.Assignee == nil {
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
	if p.ColumnID != nil && *p.ColumnID <= 0 {
		invalid(w, "ステータスを選んでください。")
		return
	}
	c, e := h.repo.UpdateItem(r.Context(), n, p)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, c)
}
func (h handler) deleteItem(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	if e := h.repo.DeleteItem(r.Context(), n); e != nil {
		fail(w, e)
		return
	}
	w.WriteHeader(204)
}

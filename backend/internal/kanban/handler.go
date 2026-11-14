package kanban

import (
	"net/http"
	"strings"
)

type handler struct {
	repo      Repository
	formatter CardFormatter
	slots     chan struct{}
}

// Option customizes NewHandler without changing the call sites that only need the repository.
type Option func(*handler)

// WithCardFormatter enables POST /api/cards/refined. A nil formatter keeps the endpoint answering 503.
func WithCardFormatter(f CardFormatter) Option {
	return func(h *handler) { h.formatter = f }
}

func NewHandler(repo Repository, opts ...Option) http.Handler {
	h := handler{repo: repo, slots: make(chan struct{}, maxConcurrentFormats)}
	for _, opt := range opts {
		opt(&h)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/board", h.board)
	mux.HandleFunc("GET /api/backlog", h.backlog)
	mux.HandleFunc("PUT /api/backlog/order", h.reorderBacklog)
	mux.HandleFunc("GET /api/cards/by-number/{number}/history", h.history)
	mux.HandleFunc("POST /api/columns", h.createColumn)
	mux.HandleFunc("PUT /api/columns/order", h.reorderColumns)
	mux.HandleFunc("POST /api/cards", h.createCard)
	mux.HandleFunc("POST /api/cards/refined", h.createRefinedCard)
	mux.HandleFunc("GET /api/cards/{id}", h.getCard)
	mux.HandleFunc("GET /api/cards/by-number/{number}", h.getCardByNumber)
	mux.HandleFunc("PATCH /api/cards/{id}", h.updateCard)
	mux.HandleFunc("PATCH /api/cards/by-number/{number}/status", h.changeStatusByNumber)
	mux.HandleFunc("DELETE /api/cards/{id}", h.deleteCard)
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
	reply(w, 200, map[string][]Card{"cards": cards})
}

func (h handler) reorderBacklog(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CardIDs []int64 `json:"cardIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := validateBacklogOrder(in.CardIDs); err != nil {
		fail(w, err)
		return
	}
	cards, err := h.repo.ReorderBacklog(r.Context(), in.CardIDs)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]Card{"cards": cards})
}

func (h handler) board(w http.ResponseWriter, r *http.Request) {
	b, e := h.repo.Board(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, b)
}
func (h handler) getCard(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	c, e := h.repo.GetCard(r.Context(), n)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, c)
}
func (h handler) getCardByNumber(w http.ResponseWriter, r *http.Request) {
	n, ok := taskNumber(w, r)
	if !ok {
		return
	}
	card, err := h.repo.GetCardByNumber(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, card)
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
func (h handler) createCard(w http.ResponseWriter, r *http.Request) {
	var in CardInput
	if !decode(w, r, &in) {
		return
	}
	var valid bool
	in.PRURLs, valid = normalizePRURLs(in.PRURLs)
	if !valid {
		invalid(w, "GitHub PRのURLを入力してください。例: https://github.com/owner/repo/pull/1")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if !validTitle(in.Title) || !validDescription(in.Description) || in.ColumnID <= 0 {
		invalid(w, "タイトルは1〜200文字、説明は10000文字以内で入力し、ステータスを選んでください。")
		return
	}
	c, e := h.repo.CreateCard(r.Context(), in)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 201, c)
}
func (h handler) updateCard(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	var p CardPatch
	if !decode(w, r, &p) {
		return
	}
	if p.Title == nil && p.Description == nil && p.ColumnID == nil && p.PRURLs == nil {
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
	c, e := h.repo.UpdateCard(r.Context(), n, p)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, c)
}
func (h handler) deleteCard(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	if e := h.repo.DeleteCard(r.Context(), n); e != nil {
		fail(w, e)
		return
	}
	w.WriteHeader(204)
}

package kanban

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// POST /api/projects/{id}/ai-chat, one step per function: read the request, admit it (limits),
// load what the model is given, ask the model, then store and answer.

const (
	// maxProjectChatModelCalls is how often the model is called for one user message.
	maxProjectChatModelCalls = 4
	// maxProjectChatDuration limits the model calls and tool runs of one user message together.
	// Plus projectChatAfterModelReserve it must stay below ProjectChatRequestTimeout.
	maxProjectChatDuration = 40 * time.Second
	// ProjectChatRequestTimeout is the request limit of POST /api/projects/{id}/ai-chat only
	// (every other route keeps RequestTimeout). nginx waits 60 seconds.
	ProjectChatRequestTimeout = 50 * time.Second
	// projectChatUsageRecordTimeout is how long recording the usage may take once the client is gone.
	projectChatUsageRecordTimeout = 3 * time.Second
	// projectChatStoreTimeout is how long storing the answer may take (also once the client is gone).
	projectChatStoreTimeout = createReserve
	// projectChatAfterModelReserve is the time kept for what follows the model: recording the
	// usage and storing the answer, each with its own limit, one after the other. If only the
	// storing were kept, both being slow would let the request time out (503) after the answer
	// was stored, and the retry would ask the question twice.
	projectChatAfterModelReserve = projectChatUsageRecordTimeout + projectChatStoreTimeout
	// Placeholder ids of the two messages of unstoredProjectChatTurn: negative, so they cannot
	// collide with a stored id or with each other (the screen keys its list by id).
	unstoredProjectChatUserID      int64 = -2
	unstoredProjectChatAssistantID int64 = -1
)

func (h handler) postProjectAIChat(w http.ResponseWriter, r *http.Request) {
	req, ok := h.decodeProjectChatRequest(w, r)
	if !ok {
		return
	}
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	admission, ok := h.admitProjectChat(w, r, user.ID)
	if !ok {
		return
	}
	defer admission.release()

	in, err := h.loadProjectChatInput(r.Context(), project, &user, req)
	if err != nil {
		fail(w, err)
		return
	}
	chatCtx, cancel, hasTime := projectChatContext(r.Context())
	defer cancel()
	if !hasTime {
		slog.Error("project ai chat skipped", "kind", "no_time")
		aiChatFailed(w)
		return
	}
	admission.keepRateReservation() // model call starts; reservation counts even if the chat fails
	answer, ok := h.askProjectChat(chatCtx, w, r, project.ID, &user, in)
	if !ok {
		return
	}
	if err := h.storeProjectChatTurn(r.Context(), project.ID, user.ID, req.Message, answer); err != nil {
		projectChatStorageFailed(w, "append")
		return
	}
	h.replyProjectChatTurn(w, r, project.ID, user.ID, in.history, req.Message, answer)
}

// ---- 1. the request ----

type projectAIChatRequest struct {
	Message         string `json:"message"`
	FocusItemNumber *int64 `json:"focusItemNumber"`
}

// decodeProjectChatRequest reads and checks the body. It answers 415 or 400 itself.
// The returned Message is the normalized one.
func (h handler) decodeProjectChatRequest(w http.ResponseWriter, r *http.Request) (projectAIChatRequest, bool) {
	if !isJSONRequest(r) {
		aiChatUnsupportedMediaType(w)
		return projectAIChatRequest{}, false
	}
	var req projectAIChatRequest
	if !decode(w, r, &req) {
		return projectAIChatRequest{}, false
	}
	msg, ok := NormalizeAIChatMessage(req.Message, h.messageMax)
	if !ok {
		aiChatInvalidMessage(w, h.messageMax)
		return projectAIChatRequest{}, false
	}
	if req.FocusItemNumber != nil && *req.FocusItemNumber <= 0 {
		invalid(w, "focusItemNumber は正のアイテム番号を指定してください。")
		return projectAIChatRequest{}, false
	}
	req.Message = msg
	return req, true
}

// ---- 2. the limits ----

// projectChatAdmission is what an admitted project chat holds until it ends: the user's
// single running chat, a rate limit reservation and one of the shared AI slots.
type projectChatAdmission struct {
	h            handler
	userID       int64
	rateUser     int64
	rateAt       time.Time
	rateReserved bool
	keepRate     bool
	releaseSlot  func()
}

// admitProjectChat checks, in this order: chat configured (503), credit limit, one running
// chat per user (429), rate limit, a free slot (429). It answers a rejection itself and then
// holds nothing. The caller must release an admission it got.
func (h handler) admitProjectChat(w http.ResponseWriter, r *http.Request, userID int64) (*projectChatAdmission, bool) {
	if h.projectChatter == nil {
		aiChatNotConfigured(w)
		return nil, false
	}
	if h.rejectIfAICreditLimitReached(w, r, aiChatError) {
		return nil, false
	}
	// One project chat per user at a time. Checked before the rate limit so a rejected
	// second request does not use up a reservation.
	if !h.projectChats.begin(userID) {
		aiChatBusy(w)
		return nil, false
	}
	a := &projectChatAdmission{h: h, userID: userID}
	var rateLimited bool
	a.rateUser, a.rateAt, a.rateReserved, rateLimited = h.reserveAIRateLimit(r)
	if rateLimited {
		// Nothing was reserved: only the running chat is given back.
		defer h.projectChats.end(userID)
		writeAIRateLimited(w, aiChatError)
		return nil, false
	}
	releaseSlot, acquired := h.acquireSlot()
	if !acquired {
		defer a.release()
		aiChatBusy(w)
		return nil, false
	}
	a.releaseSlot = releaseSlot
	return a, true
}

// keepRateReservation makes the rate limit reservation count: from here on the model is called.
func (a *projectChatAdmission) keepRateReservation() { a.keepRate = true }

// release gives back the slot, the rate limit reservation (unless it counts) and the user's running chat.
func (a *projectChatAdmission) release() {
	if a.releaseSlot != nil {
		a.releaseSlot()
	}
	if !a.keepRate {
		a.h.releaseAIRateLimit(a.rateUser, a.rateAt, a.rateReserved)
	}
	a.h.projectChats.end(a.userID)
}

// ---- 3. what the model is given ----

// projectChatInput is everything read before the model is called.
type projectChatInput struct {
	system  string
	turns   []ChatTurn         // the history for the model, ending with the new message
	columns []Column           // read once: used by the prompt and by the tools' status filter
	history []ProjectAIMessage // the stored history as it was before this message
}

// loadProjectChatInput reads the columns, the open item and the history (in this order).
func (h handler) loadProjectChatInput(ctx context.Context, project Project, user *User, req projectAIChatRequest) (projectChatInput, error) {
	columns, err := h.repo.Columns(ctx)
	if err != nil {
		return projectChatInput{}, err
	}
	focus, err := h.loadProjectChatFocus(ctx, project.ID, req.FocusItemNumber, user)
	if err != nil {
		return projectChatInput{}, err
	}
	history, err := h.repo.ListProjectAIMessages(ctx, project.ID, user.ID)
	if err != nil {
		return projectChatInput{}, err
	}
	return newProjectChatInput(project.Name, time.Now(), columns, focus, history, req.Message, h.historyTurns), nil
}

// newProjectChatInput builds the prompt and the turns from what was read. No I/O: now is
// only used for today's date in the prompt.
func newProjectChatInput(projectName string, now time.Time, columns []Column, focus *projectChatFocus, history []ProjectAIMessage, message string, historyTurns int) projectChatInput {
	turns := selectProjectChatHistoryForModel(history, historyTurns)
	turns = append(turns, ChatTurn{Role: AIRoleUser, Body: message})
	return projectChatInput{
		system:  buildProjectChatSystem(projectName, now, columns, focus),
		turns:   turns,
		columns: columns,
		history: history,
	}
}

// loadProjectChatFocus loads the open item for the prompt. A missing, trashed or hidden item
// is not an error: it gives nil, so the chat goes on without it and does not reveal whether
// the item exists. Any other failure is returned (never turned into "no item").
func (h handler) loadProjectChatFocus(ctx context.Context, projectID int64, number *int64, user *User) (*projectChatFocus, error) {
	if number == nil {
		return nil, nil
	}
	item, err := h.repo.GetItemByNumber(ctx, *number, projectID)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if item.DeletedAt != nil {
		return nil, nil
	}
	state, err := h.loadItemACLState(ctx, item)
	if err != nil {
		return nil, err
	}
	if !CanView(state, user) {
		return nil, nil
	}
	comments, err := h.repo.ListComments(ctx, item.ID)
	if err != nil {
		return nil, err
	}
	return &projectChatFocus{Item: item, Comments: comments}, nil
}

// ---- 4. asking the model ----

// projectChatContext limits the whole tool loop to maxProjectChatDuration, and to what the
// request has left after keeping projectChatAfterModelReserve for recording the usage and
// storing the answer.
func projectChatContext(ctx context.Context) (context.Context, context.CancelFunc, bool) {
	limit := maxProjectChatDuration
	if deadline, ok := ctx.Deadline(); ok {
		left := time.Until(deadline) - projectChatAfterModelReserve
		if left <= 0 {
			return ctx, func() {}, false
		}
		limit = min(limit, left)
	}
	chatCtx, cancel := context.WithTimeout(ctx, limit)
	return chatCtx, cancel, true
}

// projectChatAnswer is the model's final text and what all its calls used.
type projectChatAnswer struct {
	text          string
	inTok, outTok int64
}

// askProjectChat runs the model with the tools and records the usage. On a failure it
// answers the request itself (ok is false) and nothing may be stored.
func (h handler) askProjectChat(chatCtx context.Context, w http.ResponseWriter, r *http.Request, projectID int64, user *User, in projectChatInput) (projectChatAnswer, bool) {
	tools := newProjectToolExecutor(h.repo, projectID, user, in.columns)
	text, inTok, outTok, err := h.projectChatter.ChatWithTools(chatCtx, in.system, in.turns, projectChatTools(), tools.Run, maxProjectChatModelCalls)
	h.recordProjectChatUsage(r.Context(), err, inTok, outTok, AIChatEstimateInput(in.system, in.turns))
	if failure := classifyProjectChatFailure(chatCtx.Err() != nil, tools.failure(), err); failure != projectChatSucceeded {
		writeProjectChatFailure(w, failure, err)
		return projectChatAnswer{}, false
	}
	return projectChatAnswer{text: text, inTok: inTok, outTok: outTok}, true
}

// recordProjectChatUsage records the usage even when the client has gone away: the chat may
// take tens of seconds, and what was spent must be counted either way.
//
// Estimating a failed call is the ProjectChatter's job: inTok and outTok already include its
// estimate for a call that failed without reported usage. estimateInput is only the fallback
// for an implementation that returns a failure with zero tokens all the same; it is not used
// when tokens were reported.
func (h handler) recordProjectChatUsage(ctx context.Context, err error, inTok, outTok int64, estimateInput string) {
	usageCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), projectChatUsageRecordTimeout)
	defer cancel()
	h.applyAIUsageAfterCall(usageCtx, err, inTok, outTok, estimateInput)
}

// projectChatFailure is how a chat ended when it did not end with an answer.
type projectChatFailure int

const (
	projectChatSucceeded   projectChatFailure = iota
	projectChatToolTimeout                    // a tool ran out of time: 502 ai_failed
	projectChatToolFailed                     // a tool's repository read failed: 500 server_error
	projectChatModelFailed                    // the model call failed: 502 ai_failed
)

// classifyProjectChatFailure decides how the chat ended. toolErr is the failure inside a tool,
// chatErr the one of the model call, timedOut whether the chat's time is up. A tool failure
// comes first: a failed lookup must not become an answer ("nothing found"), whatever the
// model call returned after it.
func classifyProjectChatFailure(timedOut bool, toolErr, chatErr error) projectChatFailure {
	switch {
	case toolErr != nil && (timedOut || errors.Is(toolErr, context.DeadlineExceeded) || errors.Is(toolErr, context.Canceled)):
		return projectChatToolTimeout
	case toolErr != nil:
		return projectChatToolFailed
	case chatErr != nil:
		return projectChatModelFailed
	}
	return projectChatSucceeded
}

// writeProjectChatFailure logs and answers a failed chat. Nothing is stored after it.
func writeProjectChatFailure(w http.ResponseWriter, failure projectChatFailure, chatErr error) {
	switch failure {
	case projectChatToolTimeout:
		slog.Error("project ai chat failed", "kind", "timeout", "stage", "tool")
		aiChatFailed(w)
	case projectChatToolFailed:
		projectChatStorageFailed(w, "tool")
	case projectChatModelFailed:
		logChatFailure(chatErr)
		aiChatFailed(w)
	}
}

// projectChatStorageFailed answers a repository failure with the fixed 500. Only the stage is
// logged: the error text may carry what the user or the model searched for.
func projectChatStorageFailed(w http.ResponseWriter, stage string) {
	slog.Error("project ai chat storage failed", "stage", stage)
	aiChatServerError(w)
}

// ---- 5. storing and answering ----

// storeProjectChatTurn stores the exchange. The answer is paid for, so it is stored even when
// the client has gone away (it shows up when the chat is opened again). It may take
// projectChatStoreTimeout, which projectChatContext keeps free.
func (h handler) storeProjectChatTurn(ctx context.Context, projectID, userID int64, userBody string, answer projectChatAnswer) error {
	storeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), projectChatStoreTimeout)
	defer cancel()
	return h.repo.AppendProjectAITurn(storeCtx, projectID, userID, userBody, answer.text, answer.inTok, answer.outTok)
}

// replyProjectChatTurn answers 200 with the stored history. When reading it back fails, the
// answer is built from what is known instead.
func (h handler) replyProjectChatTurn(w http.ResponseWriter, r *http.Request, projectID, userID int64, before []ProjectAIMessage, userBody string, answer projectChatAnswer) {
	list, err := h.repo.ListProjectAIMessages(r.Context(), projectID, userID)
	if err != nil || len(list) == 0 {
		// Turn is already stored; avoid 500 so clients do not retry and duplicate.
		slog.Error("project ai chat list after append failed", "stage", "list")
		list = unstoredProjectChatTurn(projectID, before, userBody, answer)
	}
	reply(w, http.StatusOK, map[string]any{
		"assistant": list[len(list)-1],
		"messages":  list,
	})
}

// unstoredProjectChatTurn is the history as the client should see it when the stored one
// cannot be read back: the history from before, the message and the answer. The two new ones
// have no stored id or time; they get distinct negative placeholder ids.
func unstoredProjectChatTurn(projectID int64, before []ProjectAIMessage, userBody string, answer projectChatAnswer) []ProjectAIMessage {
	assistant := ProjectAIMessage{ID: unstoredProjectChatAssistantID, ProjectID: projectID, Role: AIRoleAssistant, Body: answer.text,
		InputTokens: tokenCountPtr(answer.inTok), OutputTokens: tokenCountPtr(answer.outTok)}
	return append(append([]ProjectAIMessage{}, before...),
		ProjectAIMessage{ID: unstoredProjectChatUserID, ProjectID: projectID, Role: AIRoleUser, Body: userBody}, assistant)
}

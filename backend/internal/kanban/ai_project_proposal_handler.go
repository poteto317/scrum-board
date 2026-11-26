package kanban

import (
	"errors"
	"net/http"
	"strconv"
)

// PATCH /api/projects/{id}/ai-proposals/{pid}: the state of one of the caller's proposals.
// It writes the proposal only; the item itself is changed by the item APIs the screen calls.
// No AI is called, so no AI limit applies.

const (
	msgProjectAIProposalInvalidID = "提案IDが不正です。"
	msgProjectAIProposalInvalid   = "提案の状態が不正です。"
	msgProjectAIProposalNotFound  = "提案が見つかりません。"
	msgProjectAIProposalConflict  = "この提案は既に処理されています。"
)

type projectAIProposalRequest struct {
	State             string `json:"state"`
	CreatedItemNumber *int64 `json:"createdItemNumber"`
}

// projectAIProposalChange checks the body: one of the three states, and a created item number
// (a positive one) only with "applied". Whether the change is allowed from the current state
// is the repository's check (409), not this one (400).
func projectAIProposalChange(req projectAIProposalRequest) (ProjectAIProposalChange, bool) {
	switch req.State {
	case ProposalStatePending, ProposalStateApplied, ProposalStateDismissed:
	default:
		return ProjectAIProposalChange{}, false
	}
	if req.CreatedItemNumber != nil && (*req.CreatedItemNumber <= 0 || req.State != ProposalStateApplied) {
		return ProjectAIProposalChange{}, false
	}
	return ProjectAIProposalChange{State: req.State, CreatedItemNumber: req.CreatedItemNumber}, true
}

func (h handler) updateProjectAIProposal(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	proposalID, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil || proposalID <= 0 {
		invalid(w, msgProjectAIProposalInvalidID)
		return
	}
	var req projectAIProposalRequest
	if !decode(w, r, &req) {
		return
	}
	change, ok := projectAIProposalChange(req)
	if !ok {
		invalid(w, msgProjectAIProposalInvalid)
		return
	}
	proposal, err := h.repo.UpdateProjectAIProposal(r.Context(), project.ID, user.ID, proposalID, change)
	switch {
	case errors.Is(err, ErrNotFound):
		reply(w, http.StatusNotFound, map[string]string{"message": msgProjectAIProposalNotFound})
	case errors.Is(err, ErrProposalConflict):
		reply(w, http.StatusConflict, map[string]any{"message": msgProjectAIProposalConflict, "proposal": proposal})
	case err != nil:
		fail(w, err)
	default:
		reply(w, http.StatusOK, proposal)
	}
}

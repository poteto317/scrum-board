package kanban

import (
	"context"
	"encoding/json"
	"errors"
)

// Running the proposal tools: the executor's part (loading the item, counting the proposals).
// Reading the input and checking it against what was loaded is ai_project_tool_proposals.go.

// propose runs one of the proposal tools. Only an accepted proposal counts toward the limit.
func (e *projectToolExecutor) propose(ctx context.Context, name string, raw json.RawMessage) (string, error) {
	if len(e.proposals) >= maxProposalsPerQuestion {
		return toolErrorResult(toolErrProposalLimit), nil
	}
	draft, problem, err := e.proposalDraft(ctx, name, raw)
	if err != nil || problem != "" {
		return toolErrorResult(problem), err
	}
	e.proposals = append(e.proposals, draft)
	return proposedResult(draft.Kind), nil
}

// proposalDraft runs the check of one proposal tool. problem is a fixed text for the model;
// err is a repository failure.
func (e *projectToolExecutor) proposalDraft(ctx context.Context, name string, raw json.RawMessage) (ProjectAIProposalDraft, string, error) {
	switch name {
	case toolProposeStatusChange:
		return e.statusChangeProposal(ctx, raw)
	case toolProposeDescriptionEdit:
		return e.descriptionEditProposal(ctx, raw)
	default: // toolProposeItemCreate
		return e.itemCreateProposal(raw)
	}
}

func (e *projectToolExecutor) statusChangeProposal(ctx context.Context, raw json.RawMessage) (ProjectAIProposalDraft, string, error) {
	number, status, ok := parseProposeStatusInput(raw)
	if !ok {
		return ProjectAIProposalDraft{}, toolErrInvalidInput, nil
	}
	item, problem, err := e.editableItem(ctx, number)
	if err != nil || problem != "" {
		return ProjectAIProposalDraft{}, problem, err
	}
	draft, problem := statusChangeDraft(item, e.columns, status)
	return draft, problem, nil
}

func (e *projectToolExecutor) descriptionEditProposal(ctx context.Context, raw json.RawMessage) (ProjectAIProposalDraft, string, error) {
	number, description, ok, textOK := parseProposeDescriptionInput(raw)
	switch {
	case !ok:
		return ProjectAIProposalDraft{}, toolErrInvalidInput, nil
	case !textOK:
		return ProjectAIProposalDraft{}, toolErrProposalText, nil
	}
	item, problem, err := e.editableItem(ctx, number)
	if err != nil || problem != "" {
		return ProjectAIProposalDraft{}, problem, err
	}
	if read, ok := e.readDescriptions[item.Number]; !ok || read != item.Description {
		return ProjectAIProposalDraft{}, toolErrDescriptionNotRead, nil
	}
	draft, problem := descriptionEditDraft(item, description)
	return draft, problem, nil
}

// itemCreateProposal needs no item: only the columns, already loaded.
func (e *projectToolExecutor) itemCreateProposal(raw json.RawMessage) (ProjectAIProposalDraft, string, error) {
	title, description, ok, textOK := parseProposeCreateInput(raw)
	switch {
	case !ok:
		return ProjectAIProposalDraft{}, toolErrInvalidInput, nil
	case !textOK:
		return ProjectAIProposalDraft{}, toolErrProposalText, nil
	}
	draft, problem := itemCreateDraft(e.columns, title, description)
	return draft, problem, nil
}

// editableItem loads the item a proposal is about. Missing, trashed, in another project and
// hidden are all "not found" (whether a hidden item exists must not leak). One that may be
// viewed but not edited, or is archived, gets its own fixed text.
func (e *projectToolExecutor) editableItem(ctx context.Context, number int64) (Item, string, error) {
	item, err := e.repo.GetItemByNumber(ctx, number, e.projectID)
	if errors.Is(err, ErrNotFound) {
		return Item{}, toolErrItemNotFound, nil
	}
	if err != nil {
		return Item{}, "", err
	}
	if item.DeletedAt != nil || item.ProjectID != e.projectID {
		return Item{}, toolErrItemNotFound, nil
	}
	state, err := loadItemACLStateFrom(ctx, e.repo, item)
	if err != nil {
		return Item{}, "", err
	}
	switch {
	case !CanView(state, e.user):
		return Item{}, toolErrItemNotFound, nil
	case !CanEdit(state, e.user):
		return Item{}, toolErrNotEditable, nil
	case item.ArchivedAt != nil:
		return Item{}, toolErrArchived, nil
	}
	return item, "", nil
}

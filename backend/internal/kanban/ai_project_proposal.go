package kanban

import (
	"errors"
	"time"
)

// Proposals of the project chat: the model never changes an item. Its proposal tools collect
// what it proposes; the proposals are stored with the answer, and the user applies one with a
// button (the screen then calls the item APIs with the user's own rights). This file is the
// model of a proposal and the rule of its state; storing it is ai_project_proposal_repo.go.

const (
	ProposalKindStatusChange    = "status_change"
	ProposalKindDescriptionEdit = "description_edit"
	ProposalKindItemCreate      = "item_create"

	ProposalStatePending   = "pending"
	ProposalStateApplied   = "applied"
	ProposalStateDismissed = "dismissed"

	// maxProposalsPerQuestion is how many proposals one user message may bring (accepted ones only).
	maxProposalsPerQuestion = 5
)

// ErrProposalConflict: the requested change is not allowed from the proposal's current state.
var ErrProposalConflict = errors.New("project ai proposal conflict")

// ProjectAIProposalDraft is a proposal a tool accepted, not stored yet. The column and the
// item are the ones the tool resolved (ids); the names are for showing only.
type ProjectAIProposalDraft struct {
	Kind            string
	ItemNumber      *int64
	ItemTitle       *string
	ColumnID        *int64
	ColumnName      *string
	Title           *string
	Description     *string
	BaseDescription *string
}

// ProjectAIProposal is a stored proposal. Like the messages it is always the caller's own: the
// owner is not part of the JSON.
type ProjectAIProposal struct {
	ID                int64     `json:"id"`
	MessageID         int64     `json:"messageId"`
	Kind              string    `json:"kind"`
	State             string    `json:"state"`
	ItemNumber        *int64    `json:"itemNumber,omitempty"`
	ItemTitle         *string   `json:"itemTitle,omitempty"`
	ColumnID          *int64    `json:"columnId,omitempty"`
	ColumnName        *string   `json:"columnName,omitempty"`
	Title             *string   `json:"title,omitempty"`
	Description       *string   `json:"description,omitempty"`
	BaseDescription   *string   `json:"baseDescription,omitempty"`
	CreatedItemNumber *int64    `json:"createdItemNumber,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// ProjectAIProposalChange is a requested change of a proposal's state. CreatedItemNumber is
// only given with ProposalStateApplied, to record the item an applied item_create made.
type ProjectAIProposalChange struct {
	State             string
	CreatedItemNumber *int64
}

// proposalTransitionAllowed is the transition table of the design:
//
//	pending → applied (claim, no number)    pending → dismissed
//	applied → pending (release; only while no created item is recorded)
//	applied → applied + number (item_create only, once)
func proposalTransitionAllowed(current ProjectAIProposal, change ProjectAIProposalChange) bool {
	switch {
	case current.State == ProposalStatePending && change.State == ProposalStateApplied:
		return change.CreatedItemNumber == nil
	case current.State == ProposalStatePending && change.State == ProposalStateDismissed:
		return change.CreatedItemNumber == nil
	case current.State == ProposalStateApplied && change.State == ProposalStatePending:
		return change.CreatedItemNumber == nil && current.CreatedItemNumber == nil
	case current.State == ProposalStateApplied && change.State == ProposalStateApplied:
		return change.CreatedItemNumber != nil && current.Kind == ProposalKindItemCreate && current.CreatedItemNumber == nil
	}
	return false
}

package kanban

import (
	"encoding/json"
	"strings"
)

// The proposal tools: reading their input and checking it against what was loaded. No I/O
// here; the executor loads the item and the columns (ai_project_tool_executor.go). A proposal
// changes nothing: it is stored with the answer and the user applies it.

const (
	toolProposeStatusChange    = "propose_status_change"
	toolProposeDescriptionEdit = "propose_description_edit"
	toolProposeItemCreate      = "propose_item_create"
)

type proposeStatusInput struct {
	Number *float64 `json:"number"`
	Status *string  `json:"status"`
}

type proposeDescriptionInput struct {
	Number      *float64 `json:"number"`
	Description *string  `json:"description"`
}

// proposeCreateInput has no column: an item_create proposal always goes to Todo.
type proposeCreateInput struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

// positiveItemNumber reads an item number that must be a positive integer.
func positiveItemNumber(v *float64) (int64, bool) {
	if v == nil {
		return 0, false
	}
	n, ok := wholeNumber(*v)
	return n, ok && n > 0
}

// parseProposeStatusInput returns the item number and the column name (trimmed).
func parseProposeStatusInput(raw json.RawMessage) (int64, string, bool) {
	var in proposeStatusInput
	if !decodeToolInput(raw, &in) || in.Status == nil {
		return 0, "", false
	}
	number, ok := positiveItemNumber(in.Number)
	status := strings.TrimSpace(*in.Status)
	if !ok || status == "" {
		return 0, "", false
	}
	return number, status, true
}

// parseProposeDescriptionInput returns the item number and the whole new description.
// ok is false for a malformed input; textOK is false for a description over the item limit.
func parseProposeDescriptionInput(raw json.RawMessage) (number int64, description string, ok, textOK bool) {
	var in proposeDescriptionInput
	if !decodeToolInput(raw, &in) || in.Description == nil {
		return 0, "", false, false
	}
	number, ok = positiveItemNumber(in.Number)
	if !ok {
		return 0, "", false, false
	}
	return number, *in.Description, true, validDescription(*in.Description)
}

// parseProposeCreateInput returns the title (trimmed) and the description. ok is false for a
// malformed input (a column given is one: unknown fields are refused); textOK is false when
// they break the item limits (validTitle, validDescription).
func parseProposeCreateInput(raw json.RawMessage) (title, description string, ok, textOK bool) {
	var in proposeCreateInput
	if !decodeToolInput(raw, &in) || in.Title == nil {
		return "", "", false, false
	}
	title = strings.TrimSpace(*in.Title)
	if in.Description != nil {
		description = *in.Description
	}
	return title, description, true, validTitle(title) && validDescription(description)
}

// columnByName finds the column of that exact name (the name is already trimmed).
func columnByName(columns []Column, name string) (Column, bool) {
	for _, c := range columns {
		if c.Name == name {
			return c, true
		}
	}
	return Column{}, false
}

// statusChangeDraft checks a status change of item to the column named status. The stored
// column is the resolved one (its id and name), never the model's text.
func statusChangeDraft(item Item, columns []Column, status string) (ProjectAIProposalDraft, string) {
	column, ok := columnByName(columns, status)
	if !ok {
		return ProjectAIProposalDraft{}, toolErrUnknownStatus
	}
	if column.ID == item.ColumnID {
		return ProjectAIProposalDraft{}, toolErrSameStatus
	}
	return ProjectAIProposalDraft{Kind: ProposalKindStatusChange, ItemNumber: ptrTo(item.Number), ItemTitle: ptrTo(item.Title),
		ColumnID: ptrTo(column.ID), ColumnName: ptrTo(column.Name)}, ""
}

// descriptionEditDraft checks replacing item's description with description. The current
// description is kept as the base: applying compares it with the description then.
func descriptionEditDraft(item Item, description string) (ProjectAIProposalDraft, string) {
	if description == item.Description {
		return ProjectAIProposalDraft{}, toolErrSameDescription
	}
	return ProjectAIProposalDraft{Kind: ProposalKindDescriptionEdit, ItemNumber: ptrTo(item.Number), ItemTitle: ptrTo(item.Title),
		Description: ptrTo(description), BaseDescription: ptrTo(item.Description)}, ""
}

// itemCreateDraft is a new item in the Todo column (todoColumnName).
func itemCreateDraft(columns []Column, title, description string) (ProjectAIProposalDraft, string) {
	todo, ok := columnByName(columns, todoColumnName)
	if !ok {
		return ProjectAIProposalDraft{}, toolErrNoTodoColumn
	}
	return ProjectAIProposalDraft{Kind: ProposalKindItemCreate, ColumnID: ptrTo(todo.ID), ColumnName: ptrTo(todo.Name),
		Title: ptrTo(title), Description: ptrTo(description)}, ""
}

// proposedResult is what the model gets for an accepted proposal: the kind only, never the text.
func proposedResult(kind string) string {
	return toolJSON(map[string]any{"proposed": true, "kind": kind})
}

func ptrTo[T any](v T) *T { return &v }

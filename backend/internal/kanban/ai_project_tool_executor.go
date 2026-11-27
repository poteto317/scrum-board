package kanban

import (
	"context"
	"encoding/json"
	"errors"
)

// Running the tools of the project chat: which tool a call means, and the repository reads
// each one needs. What may be viewed (ai_project_tool_view.go) and how much result text is
// left (ai_project_tool_budget.go) are decided without I/O.

// projectToolExecutor runs the tools of one user message for one user in one project.
// It is used by one request only, one call at a time.
type projectToolExecutor struct {
	repo           Repository
	projectID      int64
	user           *User
	columns        []Column
	crossProject   bool
	projectNames   map[int64]string
	budget         toolResultBudget
	failed         error // first failure that must stop the loop
	proposals      []ProjectAIProposalDraft
	readDescriptions map[int64]string
}

func newProjectToolExecutor(repo Repository, projectID int64, user *User, columns []Column, crossProject bool, projectNames map[int64]string) *projectToolExecutor {
	if projectNames == nil {
		projectNames = map[int64]string{}
	}
	return &projectToolExecutor{
		repo: repo, projectID: projectID, user: user, columns: columns,
		crossProject: crossProject, projectNames: projectNames, budget: newToolResultBudget(),
	}
}

// Proposals are the proposals the tools accepted, to store with the answer.
func (e *projectToolExecutor) Proposals() []ProjectAIProposalDraft { return e.proposals }

// failure is the error that stopped the tool loop, if any.
func (e *projectToolExecutor) failure() error { return e.failed }

// Run is the ToolRunner. Input problems, "not found" and the budget come back as fixed
// {"error": ...} texts for the model; a repository failure is returned as err and stops the loop.
func (e *projectToolExecutor) Run(ctx context.Context, call ToolCall) (string, error) {
	if e.failed != nil {
		return "", e.failed
	}
	room, ok := e.budget.room()
	if !ok {
		return e.budget.spend(toolErrorResult(toolErrBudget)), nil
	}
	var (
		result string
		err    error
	)
	switch call.Name {
	case toolSearchItems:
		result, err = e.searchItems(ctx, call.Input, min(maxSearchItemsResultChars, room))
	case toolGetItem:
		result, err = e.getItem(ctx, call.Input, min(maxGetItemResultChars, room))
	case toolProposeStatusChange, toolProposeDescriptionEdit, toolProposeItemCreate:
		result, err = e.propose(ctx, call.Name, call.Input)
	default:
		result = toolErrorResult(toolErrUnknownTool)
	}
	if err != nil {
		e.failed = err
		return "", err
	}
	return e.budget.spend(result), nil
}

// viewable keeps the items the user may view. Allowlists are read once for all restricted items.
func (e *projectToolExecutor) viewable(ctx context.Context, items []Item) ([]Item, error) {
	entries := map[int64]ItemACL{}
	if restricted := restrictedItemIDs(items); len(restricted) > 0 {
		var err error
		if entries, err = e.repo.ListACLEntriesForItems(ctx, restricted); err != nil {
			return nil, err
		}
	}
	return viewableProjectItems(items, entries, e.projectID, e.user, e.crossProject), nil
}

func (e *projectToolExecutor) projectName(id int64) string {
	return e.projectNames[id]
}

func (e *projectToolExecutor) searchItems(ctx context.Context, raw json.RawMessage, limit int) (string, error) {
	plan, problem := parseSearchItemsInput(raw, e.columns)
	if problem != "" {
		return toolErrorResult(problem), nil
	}
	if plan.UnknownStatus {
		return searchItemsResultText(unknownStatusResult(e.columns), limit), nil
	}
	plan.Search.Viewer = itemSearchViewer(e.user)
	var (
		matches []Item
		err     error
	)
	if e.crossProject {
		matches, err = e.repo.SearchViewableItems(ctx, plan.Search)
	} else {
		matches, err = e.repo.SearchProjectItems(ctx, e.projectID, plan.Search)
	}
	if err != nil {
		return "", err
	}
	matches, more := lookedAtMatches(matches)
	visible, err := e.viewable(ctx, matches)
	if err != nil {
		return "", err
	}
	return searchItemsResultText(searchItemsPage(visible, more, plan, e.columns, e.projectNames), limit), nil
}

func (e *projectToolExecutor) getItem(ctx context.Context, raw json.RawMessage, limit int) (string, error) {
	number, projectID, problem := parseGetItemInput(raw, e.crossProject)
	if problem != "" {
		return toolErrorResult(problem), nil
	}
	if !e.crossProject {
		projectID = e.projectID
	}
	item, err := e.repo.GetItemByNumber(ctx, number, projectID)
	if errors.Is(err, ErrNotFound) {
		return toolErrorResult(toolErrItemNotFound), nil
	}
	if err != nil {
		return "", err
	}
	visible, err := e.viewable(ctx, []Item{item})
	if err != nil {
		return "", err
	}
	if len(visible) == 0 {
		return toolErrorResult(toolErrItemNotFound), nil
	}
	comments, err := e.repo.ListComments(ctx, item.ID)
	if err != nil {
		return "", err
	}
	text, whole := getItemResultWithDescription(item, comments, e.columns, limit, e.projectName(item.ProjectID))
	if whole {
		e.rememberReadDescription(item)
	}
	return text, nil
}

// rememberReadDescription notes the item's description as read whole in this question.
// Only URL-project items are recorded so a cross-project read cannot satisfy a proposal check.
func (e *projectToolExecutor) rememberReadDescription(item Item) {
	if item.ProjectID != e.projectID {
		return
	}
	if e.readDescriptions == nil {
		e.readDescriptions = map[int64]string{}
	}
	e.readDescriptions[item.Number] = item.Description
}

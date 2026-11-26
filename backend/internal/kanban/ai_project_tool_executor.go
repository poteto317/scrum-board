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
	repo      Repository
	projectID int64
	user      *User
	columns   []Column
	budget    toolResultBudget
	failed    error // first failure that must stop the loop
}

func newProjectToolExecutor(repo Repository, projectID int64, user *User, columns []Column) *projectToolExecutor {
	return &projectToolExecutor{repo: repo, projectID: projectID, user: user, columns: columns, budget: newToolResultBudget()}
}

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
	return viewableProjectItems(items, entries, e.projectID, e.user), nil
}

func (e *projectToolExecutor) searchItems(ctx context.Context, raw json.RawMessage, limit int) (string, error) {
	plan, problem := parseSearchItemsInput(raw, e.columns)
	if problem != "" {
		return toolErrorResult(problem), nil
	}
	if plan.UnknownStatus {
		return searchItemsResultText(unknownStatusResult(e.columns), limit), nil
	}
	// The search itself only matches what the user may view, so total and truncated say nothing
	// about hidden items. viewable below is a second check of the same rule (it drops nothing
	// unless the two disagree).
	plan.Search.Viewer = itemSearchViewer(e.user)
	matches, err := e.repo.SearchProjectItems(ctx, e.projectID, plan.Search)
	if err != nil {
		return "", err
	}
	matches, more := lookedAtMatches(matches)
	visible, err := e.viewable(ctx, matches)
	if err != nil {
		return "", err
	}
	return searchItemsResultText(searchItemsPage(visible, more, plan, e.columns), limit), nil
}

func (e *projectToolExecutor) getItem(ctx context.Context, raw json.RawMessage, limit int) (string, error) {
	number, ok := parseGetItemInput(raw)
	if !ok {
		return toolErrorResult(toolErrInvalidInput), nil
	}
	item, err := e.repo.GetItemByNumber(ctx, number, e.projectID)
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
		// Same answer as "does not exist": whether a hidden item exists must not leak.
		return toolErrorResult(toolErrItemNotFound), nil
	}
	comments, err := e.repo.ListComments(ctx, item.ID)
	if err != nil {
		return "", err
	}
	return getItemResultText(item, comments, e.columns, limit), nil
}

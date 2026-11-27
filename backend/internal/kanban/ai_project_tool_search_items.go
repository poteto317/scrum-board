package kanban

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// maxSearchItemsResultChars is the size limit of one result, in characters of the JSON text handed to the model.
const maxSearchItemsResultChars = 8000

// search_items: reading its input into a search plan, and building its result (one page of
// the viewable matches, cut to a size limit). No I/O here; the executor runs the search.

const (
	searchItemsDefaultLimit = 10
	searchItemsMinLimit     = 1
	searchItemsMaxLimit     = 20
	searchItemsMaxOffset    = maxItemSearchMatches - 1
)

type searchItemsInput struct {
	Query    string   `json:"query"`
	Status   string   `json:"status"`
	Assignee string   `json:"assignee"`
	DueFrom  string   `json:"dueFrom"`
	DueTo    string   `json:"dueTo"`
	Sort     string   `json:"sort"`
	Limit    *float64 `json:"limit"`
	Offset   *float64 `json:"offset"`
}

// searchItemsPlan is a validated search_items input.
type searchItemsPlan struct {
	Search ItemSearch
	Limit  int
	Offset int
	// UnknownStatus is set when status names no column: nothing is searched.
	UnknownStatus bool
}

// parseSearchItemsInput validates a search_items input. A non-empty problem is the fixed
// error text for the model.
func parseSearchItemsInput(raw json.RawMessage, columns []Column) (plan searchItemsPlan, problem string) {
	var in searchItemsInput
	if !decodeToolInput(raw, &in) {
		return plan, toolErrInvalidInput
	}
	var ok bool
	if plan.Limit, ok = clampWhole(in.Limit, searchItemsDefaultLimit, searchItemsMinLimit, searchItemsMaxLimit); !ok {
		return plan, toolErrInvalidInput
	}
	if plan.Offset, ok = clampWhole(in.Offset, 0, 0, searchItemsMaxOffset); !ok {
		return plan, toolErrInvalidInput
	}
	switch strings.TrimSpace(in.Sort) {
	case "", sortUpdated:
	case sortDue:
		plan.Search.SortByDue = true
	default:
		return plan, toolErrInvalidInput
	}
	if from := strings.TrimSpace(in.DueFrom); from != "" {
		day, ok := parseTokyoDate(from)
		if !ok {
			return plan, toolErrDateFormat
		}
		plan.Search.DueFrom = &day
	}
	if to := strings.TrimSpace(in.DueTo); to != "" {
		day, ok := parseTokyoDate(to)
		if !ok {
			return plan, toolErrDateFormat
		}
		// The day itself is included: everything before the next day starts.
		next := day.AddDate(0, 0, 1)
		plan.Search.DueTo = &next
	}
	plan.Search.Terms = splitSearchTerms(in.Query)
	plan.Search.Assignee = strings.TrimSpace(in.Assignee)
	if status := strings.TrimSpace(in.Status); status != "" {
		plan.UnknownStatus = true
		for _, c := range columns {
			if strings.EqualFold(c.Name, status) {
				id := c.ID
				plan.Search.ColumnID = &id
				plan.UnknownStatus = false
				break
			}
		}
	}
	return plan, ""
}

type searchItemOut struct {
	Number      int64   `json:"number"`
	ProjectID   int64   `json:"projectId"`
	ProjectName string  `json:"projectName"`
	Title       string  `json:"title"`
	Status      string  `json:"status"`
	Assignee    string  `json:"assignee"`
	DueAt       *string `json:"dueAt"`
	Archived    bool    `json:"archived"`
	UpdatedAt   string  `json:"updatedAt"`
	Snippet     string  `json:"snippet"`
}

type searchItemsOut struct {
	Total             int             `json:"total"`
	Truncated         bool            `json:"truncated"`
	Items             []searchItemOut `json:"items"`
	AvailableStatuses []string        `json:"availableStatuses,omitempty"`
}

// searchItemsPage builds the result from the viewable matches (already cut to maxItemSearchMatches).
// more says that the query found more matches than were looked at.
func searchItemsPage(viewable []Item, more bool, plan searchItemsPlan, columns []Column, projectNames map[int64]string) searchItemsOut {
	names := columnNameByID(columns)
	out := searchItemsOut{Total: len(viewable), Truncated: more, Items: []searchItemOut{}}
	for i := plan.Offset; i < len(viewable) && len(out.Items) < plan.Limit; i++ {
		it := viewable[i]
		out.Items = append(out.Items, searchItemOut{
			Number: it.Number, ProjectID: it.ProjectID, ProjectName: projectNames[it.ProjectID],
			Title: it.Title, Status: names[it.ColumnID], Assignee: it.Assignee,
			DueAt: tokyoTimePtr(it.DueAt), Archived: it.ArchivedAt != nil, UpdatedAt: tokyoTime(it.UpdatedAt),
			Snippet: searchSnippet(it.Description, it.Solution, plan.Search.Terms),
		})
	}
	return out
}

// fitSearchItems drops items from the end until the JSON fits limit characters.
// ok is false when even an empty list does not fit.
func fitSearchItems(out searchItemsOut, limit int) (string, bool) {
	for {
		text := toolJSON(out)
		if utf8.RuneCountInString(text) <= limit {
			return text, true
		}
		if len(out.Items) == 0 {
			return "", false
		}
		out.Items = out.Items[:len(out.Items)-1]
		out.Truncated = true
	}
}

// searchItemsResultText is the result handed to the model: the page cut to limit characters,
// or the fixed "answer with what you have" error when not even an empty page fits.
func searchItemsResultText(out searchItemsOut, limit int) string {
	if text, ok := fitSearchItems(out, limit); ok {
		return text
	}
	return toolErrorResult(toolErrBudget)
}

// unknownStatusResult answers a status that names no column: nothing found, and the names that exist.
func unknownStatusResult(columns []Column) searchItemsOut {
	names := make([]string, 0, len(columns))
	for _, c := range columns {
		names = append(names, c.Name)
	}
	return searchItemsOut{Items: []searchItemOut{}, AvailableStatuses: names}
}

// lookedAtMatches cuts what the query returned to the maxItemSearchMatches that are looked at.
// more says that the query found more than that.
func lookedAtMatches(matches []Item) (looked []Item, more bool) {
	if len(matches) > maxItemSearchMatches {
		return matches[:maxItemSearchMatches], true
	}
	return matches, false
}

package kanban

import (
	"encoding/json"
	"strings"
	"time"
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
	Query    string          `json:"query"`
	Status   string          `json:"status"`
	Labels   json.RawMessage `json:"labels"`
	Assignee string          `json:"assignee"`
	DueFrom  string          `json:"dueFrom"`
	DueTo    string          `json:"dueTo"`
	Sort     string          `json:"sort"`
	Limit    *float64        `json:"limit"`
	Offset   *float64        `json:"offset"`
}

// searchItemsPlan is a validated search_items input.
type searchItemsPlan struct {
	Search ItemSearch
	Limit  int
	Offset int
	// UnknownStatus is set when status names no column: nothing is searched.
	UnknownStatus bool
	// UnknownLabel is set when labels names an unknown label: nothing is searched.
	UnknownLabel bool
}

// parseSearchItemsInput validates a search_items input. A non-empty problem is the fixed
// error text for the model.
func parseSearchItemsInput(raw json.RawMessage, columns []Column, labels []Label) (plan searchItemsPlan, problem string) {
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
	plan.Search.DueFrom, plan.Search.DueTo, problem = parseSearchDueRange(in.DueFrom, in.DueTo)
	if problem != "" {
		return plan, problem
	}
	plan.Search.Terms = splitSearchTerms(in.Query)
	plan.Search.Assignee = strings.TrimSpace(in.Assignee)
	plan.Search.ColumnID, plan.UnknownStatus = resolveSearchStatus(in.Status, columns)
	plan.Search.LabelIDs, plan.UnknownLabel, problem = parseSearchLabels(in.Labels, labels)
	if problem != "" {
		return plan, problem
	}
	return plan, ""
}

func parseSearchDueRange(dueFromRaw, dueToRaw string) (fromPtr, toPtr *time.Time, problem string) {
	if from := strings.TrimSpace(dueFromRaw); from != "" {
		day, ok := parseTokyoDate(from)
		if !ok {
			return nil, nil, toolErrDateFormat
		}
		fromPtr = &day
	}
	if to := strings.TrimSpace(dueToRaw); to != "" {
		day, ok := parseTokyoDate(to)
		if !ok {
			return nil, nil, toolErrDateFormat
		}
		// The day itself is included: everything before the next day starts.
		next := day.AddDate(0, 0, 1)
		toPtr = &next
	}
	return fromPtr, toPtr, ""
}

func resolveSearchStatus(rawStatus string, columns []Column) (columnID *int64, unknown bool) {
	status := strings.TrimSpace(rawStatus)
	if status == "" {
		return nil, false
	}
	for _, c := range columns {
		if strings.EqualFold(c.Name, status) {
			id := c.ID
			return &id, false
		}
	}
	return nil, true
}

func parseSearchLabels(raw json.RawMessage, labels []Label) (labelIDs []int64, unknown bool, problem string) {
	if len(raw) == 0 {
		return nil, false, ""
	}
	if string(raw) == "null" {
		return nil, false, toolErrInvalidInput
	}
	var names []any
	if err := json.Unmarshal(raw, &names); err != nil || names == nil || len(names) > MaxSearchLabelNames {
		return nil, false, toolErrInvalidInput
	}
	labelIDByKey := make(map[string]int64, len(labels))
	for _, l := range labels {
		labelIDByKey[LabelNameKey(l.Name)] = l.ID
	}
	seenIDs := make(map[int64]struct{}, len(names))
	for _, rawName := range names {
		s, ok := rawName.(string)
		if !ok {
			return nil, false, toolErrInvalidInput
		}
		key := LabelNameKey(s)
		if key == "" {
			return nil, false, toolErrInvalidInput
		}
		id, found := labelIDByKey[key]
		if !found {
			unknown = true
			continue
		}
		if _, dup := seenIDs[id]; dup {
			continue
		}
		seenIDs[id] = struct{}{}
		labelIDs = append(labelIDs, id)
	}
	if unknown {
		return nil, true, ""
	}
	return labelIDs, false, ""
}

type searchItemOut struct {
	Number      int64    `json:"number"`
	ProjectID   int64    `json:"projectId"`
	ProjectName string   `json:"projectName"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	Labels      []string `json:"labels"`
	Assignee    string   `json:"assignee"`
	DueAt       *string  `json:"dueAt"`
	Archived    bool     `json:"archived"`
	UpdatedAt   string   `json:"updatedAt"`
	Snippet     string   `json:"snippet"`
}

type searchItemsOut struct {
	Total             int             `json:"total"`
	Truncated         bool            `json:"truncated"`
	Items             []searchItemOut `json:"items"`
	AvailableStatuses []string        `json:"availableStatuses,omitempty"`
	AvailableLabels   *[]string       `json:"availableLabels,omitempty"`
}

func labelNameList(labels []Label) []string {
	out := make([]string, 0, len(labels))
	for _, l := range labels {
		out = append(out, l.Name)
	}
	return out
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
			Title: it.Title, Status: names[it.ColumnID], Labels: labelNameList(it.Labels), Assignee: it.Assignee,
			DueAt: tokyoTimePtr(it.DueAt), Archived: it.ArchivedAt != nil, UpdatedAt: tokyoTime(it.UpdatedAt),
			Snippet: searchSnippet(it.Description, it.Solution, plan.Search.Terms),
		})
	}
	return out
}

// fitSearchItems drops items (or trailing available names) from the end until the JSON fits limit characters.
// ok is false when even an empty list does not fit.
func fitSearchItems(out searchItemsOut, limit int) (string, bool) {
	if out.AvailableLabels != nil {
		copied := make([]string, len(*out.AvailableLabels))
		copy(copied, *out.AvailableLabels)
		out.AvailableLabels = &copied
	}
	for {
		text := toolJSON(out)
		if utf8.RuneCountInString(text) <= limit {
			return text, true
		}
		if len(out.Items) > 0 {
			out.Items = out.Items[:len(out.Items)-1]
			out.Truncated = true
			continue
		}
		if out.AvailableLabels != nil && len(*out.AvailableLabels) > 0 {
			trimmed := (*out.AvailableLabels)[:len(*out.AvailableLabels)-1]
			out.AvailableLabels = &trimmed
			out.Truncated = true
			continue
		}
		if len(out.AvailableStatuses) > 0 {
			out.AvailableStatuses = out.AvailableStatuses[:len(out.AvailableStatuses)-1]
			out.Truncated = true
			continue
		}
		return "", false
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

// unknownLabelResult answers a label that names no workspace label: nothing found, and the names that exist.
func unknownLabelResult(labels []Label) searchItemsOut {
	names := labelNameList(labels)
	return searchItemsOut{Items: []searchItemOut{}, AvailableLabels: &names}
}

// lookedAtMatches cuts what the query returned to the maxItemSearchMatches that are looked at.
// more says that the query found more than that.
func lookedAtMatches(matches []Item) (looked []Item, more bool) {
	if len(matches) > maxItemSearchMatches {
		return matches[:maxItemSearchMatches], true
	}
	return matches, false
}

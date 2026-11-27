package kanban

import (
	"encoding/json"
	"unicode/utf8"
)

// maxGetItemResultChars is the size limit of one result, in characters of the JSON text handed to the model.
const maxGetItemResultChars = 16000

// get_item: reading its input (the item number), and building its result (the item with its
// newest comments, cut to a size limit). No I/O here; the executor loads the item.

type getItemInput struct {
	Number    *float64 `json:"number"`
	ProjectID *float64 `json:"projectId"`
}

// parseGetItemInput returns the item number and (when crossProject) project id.
// problem is a fixed model-facing error when the input is invalid.
func parseGetItemInput(raw json.RawMessage, crossProject bool) (number, projectID int64, problem string) {
	var in getItemInput
	if !decodeToolInput(raw, &in) || in.Number == nil {
		return 0, 0, toolErrInvalidInput
	}
	n, ok := wholeNumber(*in.Number)
	if !ok || n <= 0 {
		return 0, 0, toolErrInvalidInput
	}
	if !crossProject {
		return n, 0, ""
	}
	if in.ProjectID == nil {
		return 0, 0, toolErrInvalidInput
	}
	pid, ok := wholeNumber(*in.ProjectID)
	if !ok || pid <= 0 {
		return 0, 0, toolErrInvalidInput
	}
	return n, pid, ""
}

type getItemCommentOut struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

type getItemOut struct {
	Number      int64               `json:"number"`
	ProjectID   int64               `json:"projectId"`
	ProjectName string              `json:"projectName"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Solution    string              `json:"solution"`
	Status      string              `json:"status"`
	Assignee    string              `json:"assignee"`
	DueAt       *string             `json:"dueAt"`
	CloseReason string              `json:"closeReason"`
	PRURLs      []string            `json:"prUrls"`
	Archived    bool                `json:"archived"`
	CreatedAt   string              `json:"createdAt"`
	UpdatedAt   string              `json:"updatedAt"`
	Comments    []getItemCommentOut `json:"comments"`
	Truncated   bool                `json:"truncated,omitempty"`
}

// getItemResult builds the get_item result. Long fields are clipped to clip characters and
// the newest maxAIChatContextComments comments are listed newest first.
func getItemResult(item Item, comments []Comment, columns []Column, clip int, projectName string) getItemOut {
	out := getItemOut{
		Number: item.Number, ProjectID: item.ProjectID, ProjectName: projectName, Title: item.Title,
		Description: clipAIChatField(item.Description, clip), Solution: clipAIChatField(item.Solution, clip),
		Status: columnNameByID(columns)[item.ColumnID], Assignee: item.Assignee, DueAt: tokyoTimePtr(item.DueAt),
		CloseReason: clipAIChatField(item.CloseReason, clip), PRURLs: append([]string{}, item.PRURLs...),
		Archived: item.ArchivedAt != nil, CreatedAt: tokyoTime(item.CreatedAt), UpdatedAt: tokyoTime(item.UpdatedAt),
		Comments: []getItemCommentOut{},
	}
	if len(comments) > maxAIChatContextComments {
		comments = comments[len(comments)-maxAIChatContextComments:]
	}
	for i := len(comments) - 1; i >= 0; i-- {
		c := comments[i]
		out.Comments = append(out.Comments, getItemCommentOut{
			Author: c.Author, Body: clipAIChatField(c.Body, maxAIChatContextFieldLen), CreatedAt: tokyoTime(c.CreatedAt),
		})
	}
	return out
}

// fitGetItemOut keeps the result within limit characters of JSON: it first drops comments
// from the end (the oldest), then clips the long fields harder. ok is false when nothing fits.
// It returns the result before encoding, so that the caller can tell what it carries.
func fitGetItemOut(item Item, comments []Comment, columns []Column, limit int, projectName string) (getItemOut, bool) {
	out := getItemResult(item, comments, columns, maxAIChatContextFieldLen, projectName)
	for {
		text := toolJSON(out)
		if utf8.RuneCountInString(text) <= limit {
			return out, true
		}
		if len(out.Comments) == 0 {
			break
		}
		out.Comments = out.Comments[:len(out.Comments)-1]
		out.Truncated = true
	}
	for _, clip := range []int{2000, 1000, 500, 100, 0} {
		out = getItemResult(item, nil, columns, clip, projectName)
		out.Truncated = true
		if clip == 0 {
			out.PRURLs = []string{}
		}
		if text := toolJSON(out); utf8.RuneCountInString(text) <= limit {
			return out, true
		}
	}
	return getItemOut{}, false
}

// getItemResultWithDescription is the result handed to the model (the item cut to limit
// characters, or the fixed "answer with what you have" error when nothing fits), and whether
// it carries the item's whole description (not clipped, not the budget error). A description
// edit replaces the whole text, so it is only accepted after the model has read it whole.
func getItemResultWithDescription(item Item, comments []Comment, columns []Column, limit int, projectName string) (string, bool) {
	out, ok := fitGetItemOut(item, comments, columns, limit, projectName)
	if !ok {
		return toolErrorResult(toolErrBudget), false
	}
	return toolJSON(out), out.Description == item.Description
}

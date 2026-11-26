package kanban

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
)

// What crosses the boundary to the model, shared by every tool: reading the JSON input the
// model wrote, and writing the JSON result (or one of the fixed error texts) it gets back.

// toolErrorResult is the JSON a tool hands the model for a problem the model can react to.
// The message is always one of the fixed texts below, never a Go error string.
func toolErrorResult(message string) string {
	return toolJSON(map[string]string{"error": message})
}

const (
	toolErrInvalidInput = "入力が正しくありません。"
	toolErrUnknownTool  = "そのツールはありません。"
	toolErrItemNotFound = "アイテムが見つかりません。"
	toolErrDateFormat   = "日付は YYYY-MM-DD の形式で指定してください。"
	toolErrBudget       = "これ以上は調べられません。ここまでの結果で答えてください。"

	toolErrProposalLimit   = "これ以上は提案できません。ここまでの提案で答えてください。"
	toolErrNotEditable     = "このアイテムは編集できないため、提案できません。"
	toolErrArchived        = "アーカイブ済みのアイテムには提案できません。"
	toolErrUnknownStatus   = "その列はありません。"
	toolErrSameStatus      = "すでにその列にあります。"
	toolErrSameDescription = "説明が今と変わりません。"
	toolErrNoTodoColumn    = "Todo の列が無いため、作成を提案できません。"
	toolErrProposalText    = "タイトルは1〜200文字、説明は10000文字以内にしてください。"
	// The model must have read the whole current description: get_item clips long ones.
	toolErrDescriptionNotRead = "説明の全文を読んでいないため、提案できません。先に get_item で今の説明を読んでください。説明が長くて全文を読めないアイテムには、説明の編集を提案できません。"
)

// toolJSON encodes a tool result. HTML characters are kept as they are: the text goes to the model, not to a page.
func toolJSON(v any) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return `{"error":"` + toolErrInvalidInput + `"}`
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// decodeToolInput reads the model's tool input. Missing or null input is an empty object.
func decodeToolInput(raw json.RawMessage, v any) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return true
	}
	// Unknown fields are refused: a misspelled filter (due_to, assignee_name) silently
	// ignored would search without it and give a wrong answer. The model gets the fixed
	// input error and can call again.
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if dec.Decode(v) != nil {
		return false
	}
	return !dec.More()
}

// wholeNumber reads a JSON number that must be an integer (10 and 10.0 are; 1.5 is not).
func wholeNumber(f float64) (int64, bool) {
	if math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || math.Abs(f) > 1e15 {
		return 0, false
	}
	return int64(f), true
}

func clampWhole(v *float64, fallback, low, high int) (int, bool) {
	if v == nil {
		return fallback, true
	}
	n, ok := wholeNumber(*v)
	if !ok {
		return 0, false
	}
	return int(min(max(n, int64(low)), int64(high))), true
}

// columnNameByID gives the status name the tool results show for a column id.
func columnNameByID(columns []Column) map[int64]string {
	names := make(map[int64]string, len(columns))
	for _, c := range columns {
		names[c.ID] = c.Name
	}
	return names
}

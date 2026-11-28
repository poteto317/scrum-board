package kanban

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
)

const (
	msgLabelDuplicate = "同じ名前のラベルがすでにあります。"
	msgLabelLimit     = "ラベルは200件までです。"
	msgLabelUnknown   = "ラベルを確認してください。"
)

// HTTP transport helpers keep parsing and response policy out of endpoint handlers.
func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}
func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		reply(w, 404, map[string]string{"message": "アイテムが見つかりません。"})
	case errors.Is(err, ErrColumn):
		reply(w, 400, map[string]string{"message": "選択したステータスは存在しません。"})
	case errors.Is(err, ErrColumnOrder):
		reply(w, 400, map[string]string{"message": "列の並び順を確認してください。"})
	case errors.Is(err, ErrItemOrder):
		reply(w, 400, map[string]string{"message": "アイテムの並び順を確認してください。"})
	case errors.Is(err, ErrBoardSettings):
		reply(w, 400, map[string]string{"message": "ボード設定を確認してください。"})
	case errors.Is(err, ErrProject):
		reply(w, 400, map[string]string{"message": "プロジェクト名は1〜80文字、または存在するプロジェクトを指定してください。"})
	case errors.Is(err, ErrProjectOrder):
		reply(w, 400, map[string]string{"message": "プロジェクトの並び順を確認してください。"})
	case errors.Is(err, ErrBacklogOrder):
		reply(w, 400, map[string]string{"message": "バックログの並び順を確認してください。"})
	case errors.Is(err, ErrCommandTemplateLimit):
		reply(w, 400, map[string]string{"message": "コマンドテンプレートは50件までです。"})
	case errors.Is(err, ErrUnknownCommandTemplateIDs):
		reply(w, 400, map[string]string{"message": "存在しないコマンドテンプレートが含まれています。"})
	case errors.Is(err, ErrRelatedItem):
		reply(w, 400, map[string]string{"message": "関連の内容を確認してください（アイテム番号・URL・重複・自分自身は不可）。"})
	case errors.Is(err, ErrDuplicate):
		reply(w, 409, map[string]string{"message": "同じ名前の列がすでにあります。"})
	case errors.Is(err, ErrUnknownLabel):
		reply(w, 400, map[string]string{"message": msgLabelUnknown})
	case errors.Is(err, ErrLabelDuplicate):
		reply(w, 409, map[string]string{"message": msgLabelDuplicate})
	case errors.Is(err, ErrLabelLimit):
		reply(w, 409, map[string]string{"message": msgLabelLimit})
	case errors.Is(err, ErrColumnMismatch):
		reply(w, 409, map[string]string{"message": "列の構成が変更されています。最新のボードを読み込んでからやり直してください。"})
	case errors.Is(err, ErrItemOrderMismatch):
		reply(w, 409, map[string]string{"message": "アイテムの構成が変更されています。最新のボードを読み込んでからやり直してください。"})
	case errors.Is(err, ErrBacklogMismatch):
		reply(w, 409, map[string]string{"message": "バックログの構成が変更されています。最新を読み込んでからやり直してください。"})
	case errors.Is(err, ErrProjectConflict):
		reply(w, 409, map[string]string{"message": "アイテムまたはスプリントがあるプロジェクト、または最後のプロジェクトは削除できません。"})
	case errors.Is(err, ErrProjectMismatch):
		reply(w, 409, map[string]string{"message": "プロジェクトの構成が変更されています。最新を読み込んでからやり直してください。"})
	case errors.Is(err, ErrSprintConflict):
		reply(w, 409, map[string]string{"message": "スプリントの状態またはメンバーの重複を確認してください。"})
	case errors.Is(err, ErrSprint):
		reply(w, 400, map[string]string{"message": "スプリントの入力内容を確認してください。"})
	case errors.Is(err, ErrRecurring):
		reply(w, 400, map[string]string{"message": "繰り返しルールの入力内容を確認してください。"})
	default:
		slog.Error("request failed", "error", err)
		reply(w, 500, map[string]string{"message": "処理に失敗しました。時間をおいて再試行してください。"})
	}
}
func invalid(w http.ResponseWriter, message string) {
	reply(w, 400, map[string]string{"message": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		invalid(w, "入力を確認してください。有効なJSONが必要です。")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		invalid(w, "JSONは1つだけ送信してください。")
		return false
	}
	return true
}
func id(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || n <= 0 {
		invalid(w, "アイテムIDが不正です。")
		return 0, false
	}
	return n, true
}

type idListIssue uint8

const (
	idListOK idListIssue = iota
	idListNull
	idListBadFormat
	idListTooMany
	idListBadElement
)

// parsePositiveIDList decodes a JSON array of positive whole numbers up to maxRaw elements.
// When dedupe is true, duplicate ids are dropped while keeping first occurrence order.
func parsePositiveIDList(raw json.RawMessage, maxRaw int, dedupe bool) ([]int64, idListIssue) {
	if string(raw) == "null" {
		return nil, idListNull
	}
	var list []any
	if err := json.Unmarshal(raw, &list); err != nil || list == nil {
		return nil, idListBadFormat
	}
	if len(list) > maxRaw {
		return nil, idListTooMany
	}
	ids := make([]int64, 0, len(list))
	for _, v := range list {
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || n <= 0 || n > 1e15 {
			return nil, idListBadElement
		}
		ids = append(ids, int64(n))
	}
	if dedupe {
		return dedupeInt64s(ids), idListOK
	}
	return ids, idListOK
}

func taskNumber(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("number"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "タスク番号が不正です。")
		return 0, false
	}
	return n, true
}

package kanban

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
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
		reply(w, 404, map[string]string{"message": "カードが見つかりません。"})
	case errors.Is(err, ErrColumn):
		reply(w, 400, map[string]string{"message": "選択したステータスは存在しません。"})
	case errors.Is(err, ErrColumnOrder):
		reply(w, 400, map[string]string{"message": "列の並び順を確認してください。"})
	case errors.Is(err, ErrCardOrder):
		reply(w, 400, map[string]string{"message": "カードの並び順を確認してください。"})
	case errors.Is(err, ErrDuplicate):
		reply(w, 409, map[string]string{"message": "同じ名前の列がすでにあります。"})
	case errors.Is(err, ErrColumnMismatch):
		reply(w, 409, map[string]string{"message": "列の構成が変更されています。最新のボードを読み込んでからやり直してください。"})
	case errors.Is(err, ErrCardOrderMismatch):
		reply(w, 409, map[string]string{"message": "カードの構成が変更されています。最新のボードを読み込んでからやり直してください。"})
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
		invalid(w, "カードIDが不正です。")
		return 0, false
	}
	return n, true
}

func taskNumber(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("number"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "タスク番号が不正です。")
		return 0, false
	}
	return n, true
}

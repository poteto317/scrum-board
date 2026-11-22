package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func failRecurring(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, 404, map[string]string{"message": "繰り返しルールが見つかりません。"})
		return
	}
	// PATCH cron/tz 失敗は create と同じ文言（handler 先行検証と同契約）。
	if errors.Is(err, ErrRecurring) {
		invalid(w, "cron は5フィールド、timezone は有効な IANA 名で入力してください。")
		return
	}
	fail(w, err)
}

func recurringPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "繰り返しルールIDが不正です。")
		return 0, false
	}
	return n, true
}

func (h handler) listRecurringRules(w http.ResponseWriter, r *http.Request) {
	projectID, err := h.activeProjectForByNumber(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	list, err := h.repo.ListRecurringRules(r.Context(), projectID)
	if err != nil {
		failRecurring(w, err)
		return
	}
	reply(w, 200, map[string][]RecurringRule{"rules": list})
}

func (h handler) createRecurringRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string          `json:"name"`
		Title       string          `json:"title"`
		Description *string         `json:"description"`
		Cron        string          `json:"cron"`
		Timezone    json.RawMessage `json:"timezone"`
		ColumnID    int64           `json:"columnId"`
		Enabled     *bool           `json:"enabled"`
		ProjectID   json.RawMessage `json:"projectId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if _, err := normalizeRecurringName(body.Name); err != nil {
		invalid(w, "名前は1〜80文字で入力してください。")
		return
	}
	if _, err := normalizeRecurringTitle(body.Title); err != nil {
		invalid(w, "タイトルは1〜200文字で入力してください。")
		return
	}
	desc := ""
	if body.Description != nil {
		desc = *body.Description
		if _, err := normalizeRecurringDescription(desc); err != nil {
			invalid(w, "説明は10000文字以内で入力してください。")
			return
		}
	}
	tz, ok := decodeCreateRecurringTimezone(w, body.Timezone)
	if !ok {
		return
	}
	if err := validateCronAndTimezone(body.Cron, tz); err != nil {
		invalid(w, "cron は5フィールド、timezone は有効な IANA 名で入力してください。")
		return
	}
	if body.ColumnID <= 0 {
		invalid(w, "列を選んでください。")
		return
	}
	projectID, err := h.resolveCreateRecurringProjectID(r, body.ProjectID)
	if err != nil {
		if errors.Is(err, ErrProject) {
			invalid(w, "projectId はアクティブプロジェクトと一致させてください。")
			return
		}
		fail(w, err)
		return
	}
	created, err := h.repo.CreateRecurringRule(r.Context(), projectID, RecurringRuleInput{
		Name:        body.Name,
		Title:       body.Title,
		Description: desc,
		Cron:        body.Cron,
		Timezone:    tz,
		ColumnID:    body.ColumnID,
		Enabled:     body.Enabled,
	})
	if err != nil {
		failRecurring(w, err)
		return
	}
	reply(w, 201, created)
}

func decodeCreateRecurringTimezone(w http.ResponseWriter, raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return defaultRecurringTZ, true
	}
	if string(raw) == "null" {
		invalid(w, "timezone は有効な IANA 名で入力してください。")
		return "", false
	}
	var tz string
	if err := json.Unmarshal(raw, &tz); err != nil {
		invalid(w, "timezone は有効な IANA 名で入力してください。")
		return "", false
	}
	tz = strings.TrimSpace(tz)
	if tz == "" {
		invalid(w, "timezone は有効な IANA 名で入力してください（空文字は不可）。")
		return "", false
	}
	return tz, true
}

func (h handler) resolveCreateRecurringProjectID(r *http.Request, raw json.RawMessage) (int64, error) {
	active, err := h.activeProjectForByNumber(r.Context())
	if err != nil {
		return 0, err
	}
	if len(raw) == 0 {
		return active, nil
	}
	if string(raw) == "null" {
		return 0, ErrProject
	}
	var pid int64
	if err := json.Unmarshal(raw, &pid); err != nil || pid <= 0 {
		return 0, ErrProject
	}
	if pid != active {
		return 0, ErrProject
	}
	return active, nil
}

func (h handler) updateRecurringRule(w http.ResponseWriter, r *http.Request) {
	n, ok := recurringPathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name        json.RawMessage `json:"name"`
		Title       json.RawMessage `json:"title"`
		Description json.RawMessage `json:"description"`
		Cron        json.RawMessage `json:"cron"`
		Timezone    json.RawMessage `json:"timezone"`
		ColumnID    json.RawMessage `json:"columnId"`
		Enabled     json.RawMessage `json:"enabled"`
	}
	if !decode(w, r, &body) {
		return
	}
	var patch RecurringRulePatch
	if len(body.Name) > 0 {
		name, ok := decodeRequiredRecurringString(w, body.Name, "名前は1〜80文字で入力してください。")
		if !ok {
			return
		}
		if _, err := normalizeRecurringName(name); err != nil {
			invalid(w, "名前は1〜80文字で入力してください。")
			return
		}
		patch.Name = &name
	}
	if len(body.Title) > 0 {
		title, ok := decodeRequiredRecurringString(w, body.Title, "タイトルは1〜200文字で入力してください。")
		if !ok {
			return
		}
		if _, err := normalizeRecurringTitle(title); err != nil {
			invalid(w, "タイトルは1〜200文字で入力してください。")
			return
		}
		patch.Title = &title
	}
	if len(body.Description) > 0 {
		if string(body.Description) == "null" {
			invalid(w, "description に null は指定できません。")
			return
		}
		var desc string
		if err := json.Unmarshal(body.Description, &desc); err != nil {
			invalid(w, "説明は10000文字以内で入力してください。")
			return
		}
		if _, err := normalizeRecurringDescription(desc); err != nil {
			invalid(w, "説明は10000文字以内で入力してください。")
			return
		}
		patch.Description = &desc
	}
	if len(body.Cron) > 0 {
		cronSpec, ok := decodeRequiredRecurringString(w, body.Cron, "cron は5フィールドで入力してください。")
		if !ok {
			return
		}
		patch.Cron = &cronSpec
	}
	if len(body.Timezone) > 0 {
		tz, ok := decodeRequiredRecurringString(w, body.Timezone, "timezone は有効な IANA 名で入力してください。")
		if !ok {
			return
		}
		tz = strings.TrimSpace(tz)
		if tz == "" {
			invalid(w, "timezone は有効な IANA 名で入力してください（空文字は不可）。")
			return
		}
		patch.Timezone = &tz
	}
	if len(body.ColumnID) > 0 {
		if string(body.ColumnID) == "null" {
			invalid(w, "列を選んでください。")
			return
		}
		var columnID int64
		if err := json.Unmarshal(body.ColumnID, &columnID); err != nil || columnID <= 0 {
			invalid(w, "列を選んでください。")
			return
		}
		patch.ColumnID = &columnID
	}
	if len(body.Enabled) > 0 {
		if string(body.Enabled) == "null" {
			invalid(w, "enabled は true または false で指定してください。")
			return
		}
		var enabled bool
		if err := json.Unmarshal(body.Enabled, &enabled); err != nil {
			invalid(w, "enabled は true または false で指定してください。")
			return
		}
		patch.Enabled = &enabled
	}
	if patch.Name == nil && patch.Title == nil && patch.Description == nil &&
		patch.Cron == nil && patch.Timezone == nil && patch.ColumnID == nil && patch.Enabled == nil {
		invalid(w, "更新する項目を指定してください。")
		return
	}
	projectID, err := h.activeProjectForByNumber(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	updated, err := h.repo.UpdateRecurringRule(r.Context(), projectID, n, patch)
	if err != nil {
		failRecurring(w, err)
		return
	}
	reply(w, 200, updated)
}

func decodeRequiredRecurringString(w http.ResponseWriter, raw json.RawMessage, msg string) (string, bool) {
	if string(raw) == "null" {
		invalid(w, msg)
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		invalid(w, msg)
		return "", false
	}
	return value, true
}

func (h handler) deleteRecurringRule(w http.ResponseWriter, r *http.Request) {
	n, ok := recurringPathID(w, r)
	if !ok {
		return
	}
	projectID, err := h.activeProjectForByNumber(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if err := h.repo.DeleteRecurringRule(r.Context(), projectID, n); err != nil {
		failRecurring(w, err)
		return
	}
	w.WriteHeader(204)
}

func (h handler) runRecurring(w http.ResponseWriter, r *http.Request) {
	if !h.requireJobRunnerAuth(w, r) {
		return
	}
	created, skipped, failed, err := h.repo.RunRecurring(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string]int{
		"created": created,
		"skipped": skipped,
		"failed":  failed,
	})
}

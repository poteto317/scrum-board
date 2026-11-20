package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

func sprintPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "スプリントIDが不正です。")
		return 0, false
	}
	return n, true
}

func failSprint(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		reply(w, 404, map[string]string{"message": "スプリントが見つかりません。"})
	case errors.Is(err, ErrSprint):
		invalid(w, "スプリントの入力内容を確認してください。")
	case errors.Is(err, ErrSprintConflict):
		reply(w, 409, map[string]string{"message": "スプリントの状態またはメンバーの重複を確認してください。"})
	case errors.Is(err, ErrProject):
		fail(w, err)
	default:
		fail(w, err)
	}
}

func (h handler) resolveSprintProjectID(r *http.Request) (int64, error) {
	pid, scoped, err := optionalQueryProjectID(r)
	if err != nil {
		return 0, err
	}
	if scoped {
		projects, err := h.repo.ListProjects(r.Context())
		if err != nil {
			return 0, err
		}
		if !projectIDExists(projects, pid) {
			return 0, ErrProject
		}
		return pid, nil
	}
	return h.activeProjectForByNumber(r.Context())
}

func (h handler) listSprints(w http.ResponseWriter, r *http.Request) {
	pid, err := h.resolveSprintProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	list, err := h.repo.ListSprints(r.Context(), pid)
	if err != nil {
		failSprint(w, err)
		return
	}
	userPtr := requestUserPtr(r)
	out := make([]Sprint, 0, len(list))
	for _, s := range list {
		enriched, err := h.enrichSprintForResponse(r.Context(), s, userPtr, true)
		if err != nil {
			fail(w, err)
			return
		}
		out = append(out, enriched)
	}
	reply(w, 200, map[string][]Sprint{"sprints": out})
}

func (h handler) createSprint(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string          `json:"name"`
		Goal      *string         `json:"goal"`
		StartDate string          `json:"startDate"`
		EndDate   string          `json:"endDate"`
		ProjectID json.RawMessage `json:"projectId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if _, err := normalizeSprintName(body.Name); err != nil {
		invalid(w, "名前は1〜120文字で入力してください。")
		return
	}
	goal := ""
	if body.Goal != nil {
		goal = *body.Goal
		if _, err := normalizeSprintGoal(goal); err != nil {
			invalid(w, "ゴールは2000文字以内で入力してください。")
			return
		}
	}
	if _, err := parseSprintDate(body.StartDate); err != nil {
		invalid(w, "開始日は YYYY-MM-DD 形式で入力してください。")
		return
	}
	if _, err := parseSprintDate(body.EndDate); err != nil {
		invalid(w, "終了日は YYYY-MM-DD 形式で入力してください。")
		return
	}
	if err := validateSprintDateRange(body.StartDate, body.EndDate); err != nil {
		invalid(w, "開始日は終了日以前にしてください。")
		return
	}
	projectID, err := h.resolveCreateSprintProjectID(r, body.ProjectID)
	if err != nil {
		fail(w, err)
		return
	}
	created, err := h.repo.CreateSprint(r.Context(), SprintCreateInput{
		Name: body.Name, Goal: goal, StartDate: body.StartDate, EndDate: body.EndDate, ProjectID: projectID,
	})
	if err != nil {
		failSprint(w, err)
		return
	}
	h.replySprintDetailStatus(w, r, created, 201)
}

func (h handler) resolveCreateSprintProjectID(r *http.Request, raw json.RawMessage) (int64, error) {
	if len(raw) == 0 {
		return h.resolveSprintProjectID(r)
	}
	if string(raw) == "null" {
		return 0, ErrProject
	}
	var pid int64
	if err := json.Unmarshal(raw, &pid); err != nil || pid <= 0 {
		return 0, ErrProject
	}
	projects, err := h.repo.ListProjects(r.Context())
	if err != nil {
		return 0, err
	}
	if !projectIDExists(projects, pid) {
		return 0, ErrProject
	}
	return pid, nil
}

func (h handler) getSprint(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	s, ok := h.loadSprintScoped(w, r, n)
	if !ok {
		return
	}
	h.replySprintDetail(w, r, s)
}

func (h handler) updateSprint(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name      json.RawMessage `json:"name"`
		Goal      json.RawMessage `json:"goal"`
		StartDate json.RawMessage `json:"startDate"`
		EndDate   json.RawMessage `json:"endDate"`
		Velocity  json.RawMessage `json:"velocity"`
		Status    json.RawMessage `json:"status"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Status) > 0 {
		invalid(w, "status は PATCH できません。activate / complete を使ってください。")
		return
	}
	var patch SprintPatch
	if len(body.Name) > 0 {
		if string(body.Name) == "null" {
			invalid(w, "名前は1〜120文字で入力してください。")
			return
		}
		var name string
		if err := json.Unmarshal(body.Name, &name); err != nil {
			invalid(w, "名前は1〜120文字で入力してください。")
			return
		}
		if _, err := normalizeSprintName(name); err != nil {
			invalid(w, "名前は1〜120文字で入力してください。")
			return
		}
		patch.Name = &name
	}
	if len(body.Goal) > 0 {
		if string(body.Goal) == "null" {
			invalid(w, "ゴールは2000文字以内で入力してください。")
			return
		}
		var goal string
		if err := json.Unmarshal(body.Goal, &goal); err != nil {
			invalid(w, "ゴールは2000文字以内で入力してください。")
			return
		}
		if _, err := normalizeSprintGoal(goal); err != nil {
			invalid(w, "ゴールは2000文字以内で入力してください。")
			return
		}
		patch.Goal = &goal
	}
	if len(body.StartDate) > 0 {
		date, ok := decodeSprintDateField(w, body.StartDate, "開始日")
		if !ok {
			return
		}
		patch.StartDate = &date
	}
	if len(body.EndDate) > 0 {
		date, ok := decodeSprintDateField(w, body.EndDate, "終了日")
		if !ok {
			return
		}
		patch.EndDate = &date
	}
	velocityPresent := len(body.Velocity) > 0
	if velocityPresent {
		if string(body.Velocity) == "null" {
			patch.ClearVelocity = true
		} else {
			v, ok := decodeSprintVelocity(w, body.Velocity)
			if !ok {
				return
			}
			patch.Velocity = &v
		}
	}
	if patch.Name == nil && patch.Goal == nil && patch.StartDate == nil && patch.EndDate == nil && patch.Velocity == nil && !patch.ClearVelocity {
		invalid(w, "変更するプロパティが必要です。")
		return
	}
	existing, ok := h.loadSprintScoped(w, r, n)
	if !ok {
		return
	}
	// Velocity on non-completed is rejected after load so the message is accurate (L-002 / L-930).
	if velocityPresent && existing.Status != SprintStatusCompleted {
		invalid(w, "ベロシティは完了済みスプリントでのみ設定できます。")
		return
	}
	if patch.StartDate != nil || patch.EndDate != nil {
		start, end := existing.StartDate, existing.EndDate
		if patch.StartDate != nil {
			start = *patch.StartDate
		}
		if patch.EndDate != nil {
			end = *patch.EndDate
		}
		if err := validateSprintDateRange(start, end); err != nil {
			invalid(w, "開始日は終了日以前にしてください。")
			return
		}
	}
	updated, err := h.repo.UpdateSprint(r.Context(), n, patch)
	if err != nil {
		failSprint(w, err)
		return
	}
	h.replySprintDetail(w, r, updated)
}

func decodeSprintDateField(w http.ResponseWriter, raw json.RawMessage, label string) (string, bool) {
	if string(raw) == "null" {
		invalid(w, label+"は YYYY-MM-DD 形式で入力してください。")
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		invalid(w, label+"は YYYY-MM-DD 形式で入力してください。")
		return "", false
	}
	if _, err := parseSprintDate(s); err != nil {
		invalid(w, label+"は YYYY-MM-DD 形式で入力してください。")
		return "", false
	}
	return s, true
}

func decodeSprintVelocity(w http.ResponseWriter, raw json.RawMessage) (int, bool) {
	v, err := parseSprintVelocityJSON(raw)
	if err != nil {
		invalid(w, "ベロシティは0以上の整数で指定してください。")
		return 0, false
	}
	return v, true
}

func (h handler) deleteSprint(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	if _, ok := h.loadSprintScoped(w, r, n); !ok {
		return
	}
	if err := h.repo.DeleteSprint(r.Context(), n); err != nil {
		failSprint(w, err)
		return
	}
	w.WriteHeader(204)
}

func (h handler) replaceSprintItems(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	var body struct {
		ItemIDs []int64 `json:"itemIds"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ItemIDs == nil {
		invalid(w, "itemIds を指定してください。")
		return
	}
	if err := validateReplaceSprintItemIDs(body.ItemIDs); err != nil {
		invalid(w, err.Error())
		return
	}
	existing, ok := h.loadSprintScoped(w, r, n)
	if !ok {
		return
	}
	if existing.Status == SprintStatusCompleted {
		failSprint(w, ErrSprintConflict)
		return
	}
	retainIDs, ok := h.prepareReplaceSprintItems(w, r, existing, body.ItemIDs)
	if !ok {
		return
	}
	updated, err := h.repo.ReplaceSprintItems(r.Context(), n, body.ItemIDs, retainIDs)
	if err != nil {
		failSprint(w, err)
		return
	}
	h.replySprintDetail(w, r, updated)
}

func (h handler) activateSprint(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	if _, ok := h.loadSprintScoped(w, r, n); !ok {
		return
	}
	updated, err := h.repo.ActivateSprint(r.Context(), n)
	if err != nil {
		failSprint(w, err)
		return
	}
	h.replySprintDetail(w, r, updated)
}

func (h handler) completeSprint(w http.ResponseWriter, r *http.Request) {
	n, ok := sprintPathID(w, r)
	if !ok {
		return
	}
	if _, ok := h.loadSprintScoped(w, r, n); !ok {
		return
	}
	velocity, okVel := decodeCompleteSprintBody(w, r)
	if !okVel {
		return
	}
	updated, err := h.repo.CompleteSprint(r.Context(), n, velocity)
	if err != nil {
		failSprint(w, err)
		return
	}
	h.replySprintDetail(w, r, updated)
}

func decodeCompleteSprintBody(w http.ResponseWriter, r *http.Request) (*int, bool) {
	// Empty body: ContentLength 0, or tests passing "".
	if r.Body == nil || r.ContentLength == 0 {
		return nil, true
	}
	var body struct {
		Velocity json.RawMessage `json:"velocity"`
	}
	if !decode(w, r, &body) {
		return nil, false
	}
	if len(body.Velocity) == 0 {
		return nil, true
	}
	if string(body.Velocity) == "null" {
		invalid(w, "ベロシティは0以上の整数で指定してください。")
		return nil, false
	}
	v, ok := decodeSprintVelocity(w, body.Velocity)
	if !ok {
		return nil, false
	}
	return &v, true
}

func (h handler) replySprintDetail(w http.ResponseWriter, r *http.Request, s Sprint) {
	h.replySprintDetailStatus(w, r, s, 200)
}

func (h handler) replySprintDetailStatus(w http.ResponseWriter, r *http.Request, s Sprint, status int) {
	userPtr := requestUserPtr(r)
	enriched, err := h.enrichSprintForResponse(r.Context(), s, userPtr, false)
	if err != nil {
		fail(w, err)
		return
	}
	// Always include suggestedVelocity on detail (including 0).
	reply(w, status, sprintDetailResponseBody(enriched))
}

func (h handler) filterSprintItems(ctx context.Context, items []SprintItem, user *User) ([]SprintItem, error) {
	if len(items) == 0 {
		return []SprintItem{}, nil
	}
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	full := make([]Item, 0, len(items))
	for _, id := range ids {
		item, err := h.repo.GetItem(ctx, id)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		full = append(full, item)
	}
	visible, err := h.filterBoardItems(ctx, full, user)
	if err != nil {
		return nil, err
	}
	vis := map[int64]struct{}{}
	for _, it := range visible {
		vis[it.ID] = struct{}{}
	}
	out := make([]SprintItem, 0, len(items))
	for _, it := range items {
		if _, ok := vis[it.ID]; ok {
			out = append(out, it)
		}
	}
	return out, nil
}

func (h handler) invisibleSprintMemberIDs(ctx context.Context, items []SprintItem, user *User) ([]int64, error) {
	filtered, err := h.filterSprintItems(ctx, items, user)
	if err != nil {
		return nil, err
	}
	vis := map[int64]struct{}{}
	for _, it := range filtered {
		vis[it.ID] = struct{}{}
	}
	out := make([]int64, 0)
	for _, it := range items {
		if _, ok := vis[it.ID]; !ok {
			out = append(out, it.ID)
		}
	}
	return out, nil
}


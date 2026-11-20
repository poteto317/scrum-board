package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
)

func suggestedVelocity(columns []Column, items []SprintItem) int {
	var doneID int64
	found := false
	for _, col := range columns {
		if col.Name == "Done" {
			doneID = col.ID
			found = true
			break
		}
	}
	if !found {
		return 0
	}
	n := 0
	for _, it := range items {
		if it.ColumnID == doneID {
			n++
		}
	}
	return n
}

// enrichSprintForResponse applies ACL filtering. summary clears items and zeroes suggestedVelocity (list).
func (h handler) enrichSprintForResponse(ctx context.Context, s Sprint, user *User, summary bool) (Sprint, error) {
	filtered, err := h.filterSprintItems(ctx, s.Items, user)
	if err != nil {
		return Sprint{}, err
	}
	s.ItemCount = len(filtered)
	if summary {
		s.Items = nil
		s.SuggestedVelocity = 0
		return s, nil
	}
	s.Items = filtered
	if s.Items == nil {
		s.Items = []SprintItem{}
	}
	board, err := h.repo.Board(ctx)
	if err != nil {
		return Sprint{}, err
	}
	s.SuggestedVelocity = suggestedVelocity(board.Columns, filtered)
	return s, nil
}

func sprintDetailResponseBody(s Sprint) any {
	return struct {
		ID                int64        `json:"id"`
		ProjectID         int64        `json:"projectId"`
		Name              string       `json:"name"`
		Goal              string       `json:"goal"`
		StartDate         string       `json:"startDate"`
		EndDate           string       `json:"endDate"`
		Status            SprintStatus `json:"status"`
		Velocity          *int         `json:"velocity"`
		SuggestedVelocity int          `json:"suggestedVelocity"`
		ItemCount         int          `json:"itemCount"`
		Items             []SprintItem `json:"items"`
		CreatedAt         interface{}  `json:"createdAt"`
		UpdatedAt         interface{}  `json:"updatedAt"`
	}{
		ID: s.ID, ProjectID: s.ProjectID, Name: s.Name, Goal: s.Goal,
		StartDate: s.StartDate, EndDate: s.EndDate, Status: s.Status, Velocity: s.Velocity,
		SuggestedVelocity: s.SuggestedVelocity, ItemCount: s.ItemCount, Items: s.Items,
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
	}
}

func parseSprintVelocityJSON(raw json.RawMessage) (int, error) {
	var num json.Number
	if err := json.Unmarshal(raw, &num); err != nil {
		return 0, ErrSprint
	}
	f, err := num.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || f < 0 || f > float64(math.MaxInt32) {
		return 0, ErrSprint
	}
	return int(f), nil
}

type errSprintInput struct {
	msg string
}

func (e errSprintInput) Error() string { return e.msg }
func (e errSprintInput) Unwrap() error { return ErrSprint }

func validateReplaceSprintItemIDs(ids []int64) error {
	seen := map[int64]struct{}{}
	for _, id := range ids {
		if id <= 0 {
			return errSprintInput{msg: "itemIds の各要素は正の整数である必要があります。"}
		}
		if _, dup := seen[id]; dup {
			return errSprintInput{msg: "itemIds に重複があります。"}
		}
		seen[id] = struct{}{}
	}
	return nil
}

func (h handler) prepareReplaceSprintItems(
	w http.ResponseWriter,
	r *http.Request,
	existing Sprint,
	itemIDs []int64,
) (retainIDs []int64, ok bool) {
	ctx := r.Context()
	userPtr := requestUserPtr(r)
	for _, id := range itemIDs {
		item, err := h.repo.GetItem(ctx, id)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				reply(w, 404, map[string]string{"message": "アイテムが見つかりません。"})
				return nil, false
			}
			fail(w, err)
			return nil, false
		}
		if item.ProjectID != existing.ProjectID {
			invalid(w, "スプリントと同じプロジェクトのアイテムのみ追加できます。")
			return nil, false
		}
		if _, ok := h.requireEdit(w, r, item); !ok {
			return nil, false
		}
	}
	var err error
	retainIDs, err = h.invisibleSprintMemberIDs(ctx, existing.Items, userPtr)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	return retainIDs, true
}

// loadSprintScoped loads a sprint by id. When ?projectId= is present, the sprint must belong to that project (else 404).
func (h handler) loadSprintScoped(w http.ResponseWriter, r *http.Request, id int64) (Sprint, bool) {
	s, err := h.repo.GetSprint(r.Context(), id)
	if err != nil {
		failSprint(w, err)
		return Sprint{}, false
	}
	pid, scoped, err := optionalQueryProjectID(r)
	if err != nil {
		fail(w, err)
		return Sprint{}, false
	}
	if !scoped {
		return s, true
	}
	projects, err := h.repo.ListProjects(r.Context())
	if err != nil {
		fail(w, err)
		return Sprint{}, false
	}
	if !projectIDExists(projects, pid) {
		fail(w, ErrProject)
		return Sprint{}, false
	}
	if s.ProjectID != pid {
		failSprint(w, ErrNotFound)
		return Sprint{}, false
	}
	return s, true
}
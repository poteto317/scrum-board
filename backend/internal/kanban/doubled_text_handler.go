package kanban

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
)

// doubledTextFoldLimit is the fold cap used by the repair API.
const doubledTextFoldLimit = 8

func foldLimitWarning(itemID int64, field string) string {
	return fmt.Sprintf("item %s %s: fold limit reached", strconv.FormatInt(itemID, 10), field)
}

type doubledRepairEntry struct {
	ItemID int64  `json:"itemId"`
	Field  string `json:"field"`
}

type doubledRepairResponse struct {
	DryRun              bool                 `json:"dryRun"`
	Scanned             int                  `json:"scanned"`
	DescriptionRepaired int                  `json:"descriptionRepaired"`
	SolutionRepaired    int                  `json:"solutionRepaired"`
	ItemIDs             []int64              `json:"itemIds"`
	Repairs             []doubledRepairEntry `json:"repairs"`
	Warnings            []string             `json:"warnings"`
	FailedItemIDs       []int64              `json:"failedItemIds"`
}

func parseRepairDoubledDryRun(w http.ResponseWriter, r *http.Request) (dryRun bool, ok bool) {
	var body struct {
		DryRun json.RawMessage `json:"dryRun"`
	}
	if !decode(w, r, &body) {
		return false, false
	}
	if len(body.DryRun) == 0 {
		return false, true
	}
	if string(body.DryRun) == "null" {
		invalid(w, "dryRun は true または false で指定してください。")
		return false, false
	}
	if err := json.Unmarshal(body.DryRun, &dryRun); err != nil {
		invalid(w, "dryRun は true または false で指定してください。")
		return false, false
	}
	return dryRun, true
}

func (h handler) repairDoubledText(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	dryRun, ok := parseRepairDoubledDryRun(w, r)
	if !ok {
		return
	}

	items, err := h.repo.ListLivingItems(r.Context())
	if err != nil {
		fail(w, err)
		return
	}

	resp := doubledRepairResponse{
		DryRun:        dryRun,
		Scanned:       len(items),
		ItemIDs:       []int64{},
		Repairs:       []doubledRepairEntry{},
		Warnings:      []string{},
		FailedItemIDs: []int64{},
	}

	for _, it := range items {
		descOut, _, descHit := collapseExactDoubledText(it.Description, doubledTextFoldLimit)
		solOut, _, solHit := collapseExactDoubledText(it.Solution, doubledTextFoldLimit)
		if descHit {
			resp.Warnings = append(resp.Warnings, foldLimitWarning(it.ID, "description"))
		}
		if solHit {
			resp.Warnings = append(resp.Warnings, foldLimitWarning(it.ID, "solution"))
		}

		descChanged := descOut != it.Description
		solChanged := solOut != it.Solution
		if !descChanged && !solChanged {
			continue
		}

		if !dryRun {
			patch := ItemPatch{}
			if descChanged {
				d := descOut
				patch.Description = &d
			}
			if solChanged {
				s := solOut
				patch.Solution = &s
			}
			if _, err := h.repo.UpdateItem(r.Context(), it.ID, patch); err != nil {
				resp.FailedItemIDs = append(resp.FailedItemIDs, it.ID)
				continue
			}
		}

		if descChanged {
			resp.Repairs = append(resp.Repairs, doubledRepairEntry{ItemID: it.ID, Field: "description"})
			resp.DescriptionRepaired++
		}
		if solChanged {
			resp.Repairs = append(resp.Repairs, doubledRepairEntry{ItemID: it.ID, Field: "solution"})
			resp.SolutionRepaired++
		}
	}

	seen := map[int64]struct{}{}
	for _, e := range resp.Repairs {
		if _, ok := seen[e.ItemID]; ok {
			continue
		}
		seen[e.ItemID] = struct{}{}
		resp.ItemIDs = append(resp.ItemIDs, e.ItemID)
	}
	slices.Sort(resp.ItemIDs)
	slices.Sort(resp.FailedItemIDs)
	reply(w, http.StatusOK, resp)
}

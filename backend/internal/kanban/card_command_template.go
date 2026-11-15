package kanban

import "errors"

// ErrUnknownCommandTemplateIDs means one or more templateIds are not in the catalog.
var ErrUnknownCommandTemplateIDs = errors.New("unknown command template ids")

// dedupeTemplateIDs keeps first-seen order and drops later duplicates.
func dedupeTemplateIDs(ids []int64) []int64 {
	if len(ids) == 0 {
		return []int64{}
	}
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

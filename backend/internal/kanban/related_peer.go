package kanban

import (
	"sort"
	"strconv"
)

func relatedItemPeerKey(rel RelatedItem) (string, bool) {
	if rel.Kind != relatedKindItem {
		return "", false
	}
	return strconv.FormatInt(rel.ProjectID, 10) + ":" + strconv.FormatInt(rel.Number, 10), true
}

func relatedItemPeerSet(items []RelatedItem) map[string]RelatedItem {
	out := make(map[string]RelatedItem)
	for _, rel := range items {
		key, ok := relatedItemPeerKey(rel)
		if !ok {
			continue
		}
		out[key] = rel
	}
	return out
}

// relatedItemPeersDiff returns the symmetric set of item-kind peers that differ
// between before and after (added or removed; not labeled which). Order is stable by key.
func relatedItemPeersDiff(before, after []RelatedItem) []RelatedItem {
	prev := relatedItemPeerSet(before)
	next := relatedItemPeerSet(after)
	keys := make([]string, 0)
	for key := range next {
		if _, ok := prev[key]; !ok {
			keys = append(keys, key)
		}
	}
	for key := range prev {
		if _, ok := next[key]; !ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	changed := make([]RelatedItem, 0, len(keys))
	for _, key := range keys {
		if rel, ok := next[key]; ok {
			changed = append(changed, rel)
			continue
		}
		changed = append(changed, prev[key])
	}
	return changed
}

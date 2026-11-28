package kanban

import (
	"context"
	"slices"
)

// Memory labels live on the cards themselves (Item.Labels), so every read path carries them.

func (m *memoryRepo) ListLabels(context.Context) ([]Label, error) {
	return cloneLabels(m.labels), nil
}

func (m *memoryRepo) labelKeyTaken(key string, exceptID int64) bool {
	for _, l := range m.labels {
		if l.ID != exceptID && LabelNameKey(l.Name) == key {
			return true
		}
	}
	return false
}

func (m *memoryRepo) CreateLabel(_ context.Context, in LabelInput) (Label, error) {
	if len(m.labels) >= MaxWorkspaceLabels {
		return Label{}, ErrLabelLimit
	}
	if m.labelKeyTaken(LabelNameKey(in.Name), 0) {
		return Label{}, ErrLabelDuplicate
	}
	if m.nextLabelID == 0 {
		m.nextLabelID = 1
	}
	l := Label{ID: m.nextLabelID, Name: in.Name, Color: in.Color}
	m.nextLabelID++
	m.labels = append(m.labels, l)
	return l, nil
}

func (m *memoryRepo) UpdateLabel(_ context.Context, id int64, p LabelPatch) (Label, error) {
	idx := slices.IndexFunc(m.labels, func(l Label) bool { return l.ID == id })
	if idx < 0 {
		return Label{}, ErrNotFound
	}
	l := m.labels[idx]
	if p.Name != nil {
		if m.labelKeyTaken(LabelNameKey(*p.Name), id) {
			return Label{}, ErrLabelDuplicate
		}
		l.Name = *p.Name
	}
	if p.Color != nil {
		l.Color = *p.Color
	}
	m.labels[idx] = l
	for cid, c := range m.cards {
		for i := range c.Labels {
			if c.Labels[i].ID == id {
				c.Labels = cloneLabels(c.Labels)
				c.Labels[i] = l
				m.cards[cid] = c
				break
			}
		}
	}
	return l, nil
}

func (m *memoryRepo) DeleteLabel(_ context.Context, id int64) error {
	idx := slices.IndexFunc(m.labels, func(l Label) bool { return l.ID == id })
	if idx < 0 {
		return ErrNotFound
	}
	m.labels = slices.Delete(m.labels, idx, idx+1)
	for cid, c := range m.cards {
		kept := make([]Label, 0, len(c.Labels))
		for _, l := range c.Labels {
			if l.ID != id {
				kept = append(kept, l)
			}
		}
		c.Labels = kept
		m.cards[cid] = c
	}
	return nil
}

// resolveLabels maps ids to labels (id ASC, duplicates dropped); an unknown id is ErrUnknownLabel.
func (m *memoryRepo) resolveLabels(ids []int64) ([]Label, error) {
	out := []Label{}
	for _, id := range dedupeInt64s(ids) {
		idx := slices.IndexFunc(m.labels, func(l Label) bool { return l.ID == id })
		if idx < 0 {
			return nil, ErrUnknownLabel
		}
		out = append(out, m.labels[idx])
	}
	slices.SortFunc(out, func(a, b Label) int { return int(a.ID - b.ID) })
	return out, nil
}

func itemHasAllLabels(it Item, ids []int64) bool {
	for _, id := range ids {
		if !slices.ContainsFunc(it.Labels, func(l Label) bool { return l.ID == id }) {
			return false
		}
	}
	return true
}

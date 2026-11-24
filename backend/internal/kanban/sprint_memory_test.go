package kanban

import (
	"context"
	"slices"
	"time"
)

func (m *memoryRepo) ensureSprints() {
	if m.sprints == nil {
		m.sprints = map[int64]Sprint{}
	}
	if m.sprintItems == nil {
		m.sprintItems = map[int64][]int64{}
	}
	if m.nextSprintID == 0 {
		m.nextSprintID = 1
	}
}

func (m *memoryRepo) ListSprints(_ context.Context, projectID int64) ([]Sprint, error) {
	m.ensureSprints()
	out := []Sprint{}
	for _, s := range m.sprints {
		if s.ProjectID != projectID {
			continue
		}
		cp := m.sprintWithItems(s.ID)
		out = append(out, cp)
	}
	slices.SortFunc(out, func(a, b Sprint) int {
		if a.StartDate != b.StartDate {
			if a.StartDate > b.StartDate {
				return -1
			}
			return 1
		}
		if a.ID > b.ID {
			return -1
		}
		if a.ID < b.ID {
			return 1
		}
		return 0
	})
	return out, nil
}

func (m *memoryRepo) GetSprint(_ context.Context, id int64) (Sprint, error) {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return Sprint{}, ErrNotFound
	}
	return m.sprintWithItems(s.ID), nil
}

func (m *memoryRepo) CreateSprint(_ context.Context, in SprintCreateInput) (Sprint, error) {
	m.ensureSprints()
	name, err := normalizeSprintName(in.Name)
	if err != nil {
		return Sprint{}, err
	}
	goal, err := normalizeSprintGoal(in.Goal)
	if err != nil {
		return Sprint{}, err
	}
	start, err := parseSprintDate(in.StartDate)
	if err != nil {
		return Sprint{}, err
	}
	end, err := parseSprintDate(in.EndDate)
	if err != nil {
		return Sprint{}, err
	}
	if err = validateSprintDateRange(start, end); err != nil {
		return Sprint{}, err
	}
	if in.ProjectID <= 0 || !m.projectExists(in.ProjectID) {
		return Sprint{}, ErrProject
	}
	now := time.Now().UTC()
	id := m.nextSprintID
	m.nextSprintID++
	s := Sprint{
		ID: id, ProjectID: in.ProjectID, Name: name, Goal: goal,
		StartDate: start, EndDate: end, Status: SprintStatusPlanned,
		CreatedAt: now, UpdatedAt: now, Items: []SprintItem{},
	}
	m.sprints[id] = s
	m.sprintItems[id] = []int64{}
	return m.sprintWithItems(id), nil
}

func (m *memoryRepo) UpdateSprint(_ context.Context, id int64, p SprintPatch) (Sprint, error) {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return Sprint{}, ErrNotFound
	}
	if p.Name != nil {
		name, err := normalizeSprintName(*p.Name)
		if err != nil {
			return Sprint{}, err
		}
		s.Name = name
	}
	if p.Goal != nil {
		goal, err := normalizeSprintGoal(*p.Goal)
		if err != nil {
			return Sprint{}, err
		}
		s.Goal = goal
	}
	start, end := s.StartDate, s.EndDate
	var err error
	if p.StartDate != nil {
		start, err = parseSprintDate(*p.StartDate)
		if err != nil {
			return Sprint{}, err
		}
	}
	if p.EndDate != nil {
		end, err = parseSprintDate(*p.EndDate)
		if err != nil {
			return Sprint{}, err
		}
	}
	if err = validateSprintDateRange(start, end); err != nil {
		return Sprint{}, err
	}
	s.StartDate, s.EndDate = start, end
	if p.ClearVelocity {
		if s.Status != SprintStatusCompleted {
			return Sprint{}, ErrSprint
		}
		s.Velocity = nil
	} else if p.Velocity != nil {
		if s.Status != SprintStatusCompleted {
			return Sprint{}, ErrSprint
		}
		if *p.Velocity < 0 {
			return Sprint{}, ErrSprint
		}
		v := *p.Velocity
		s.Velocity = &v
	}
	s.UpdatedAt = time.Now().UTC()
	m.sprints[id] = s
	return m.sprintWithItems(id), nil
}

func (m *memoryRepo) DeleteSprint(_ context.Context, id int64) error {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return ErrNotFound
	}
	if s.Status == SprintStatusCompleted {
		return ErrSprintConflict
	}
	delete(m.sprints, id)
	delete(m.sprintItems, id)
	return nil
}

func (m *memoryRepo) ReplaceSprintItems(_ context.Context, id int64, itemIDs, retainIDs []int64) (Sprint, error) {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return Sprint{}, ErrNotFound
	}
	if s.Status == SprintStatusCompleted {
		return Sprint{}, ErrSprintConflict
	}
	prev := append([]int64(nil), m.sprintItems[id]...)
	final, err := buildFinalSprintItemIDs(prev, itemIDs, retainIDs)
	if err != nil {
		return Sprint{}, err
	}
	for _, iid := range final {
		if err := m.assertSprintMemberEligible(s, iid); err != nil {
			return Sprint{}, err
		}
	}
	m.sprintItems[id] = final
	s.UpdatedAt = time.Now().UTC()
	m.sprints[id] = s
	return m.sprintWithItems(id), nil
}

// ActivateSprint mirrors MySQL single-active-per-project rules (no row locks in memory).
func (m *memoryRepo) ActivateSprint(_ context.Context, id int64) (Sprint, error) {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return Sprint{}, ErrNotFound
	}
	if s.Status != SprintStatusPlanned {
		return Sprint{}, ErrSprintConflict
	}
	for _, other := range m.sprints {
		if other.ProjectID == s.ProjectID && other.Status == SprintStatusActive && other.ID != id {
			return Sprint{}, ErrSprintConflict
		}
	}
	s.Status = SprintStatusActive
	s.UpdatedAt = time.Now().UTC()
	m.sprints[id] = s
	return m.sprintWithItems(id), nil
}

func (m *memoryRepo) CompleteSprint(_ context.Context, id int64, velocity *int) (Sprint, error) {
	m.ensureSprints()
	s, ok := m.sprints[id]
	if !ok {
		return Sprint{}, ErrNotFound
	}
	if s.Status != SprintStatusActive {
		return Sprint{}, ErrSprintConflict
	}
	if velocity != nil && *velocity < 0 {
		return Sprint{}, ErrSprint
	}
	s.Status = SprintStatusCompleted
	if velocity != nil {
		v := *velocity
		s.Velocity = &v
	}
	s.UpdatedAt = time.Now().UTC()
	m.sprints[id] = s
	return m.sprintWithItems(id), nil
}

func (m *memoryRepo) CountSprintsForProject(_ context.Context, projectID int64) (int64, error) {
	m.ensureSprints()
	var n int64
	for _, s := range m.sprints {
		if s.ProjectID == projectID {
			n++
		}
	}
	return n, nil
}

func (m *memoryRepo) DeleteSprintItemsForItem(_ context.Context, itemID int64) error {
	m.ensureSprints()
	for sid, ids := range m.sprintItems {
		next := ids[:0:0]
		for _, id := range ids {
			if id != itemID {
				next = append(next, id)
			}
		}
		if next == nil {
			next = []int64{}
		}
		m.sprintItems[sid] = next
	}
	return nil
}

func (m *memoryRepo) assertSprintMemberEligible(sprint Sprint, itemID int64) error {
	c, ok := m.cards[itemID]
	if !ok || !m.living(c) {
		return ErrNotFound
	}
	if m.cardProjectID(c) != sprint.ProjectID {
		return ErrSprint
	}
	for sid, ids := range m.sprintItems {
		if sid == sprint.ID {
			continue
		}
		other, ok := m.sprints[sid]
		if !ok || (other.Status != SprintStatusPlanned && other.Status != SprintStatusActive) {
			continue
		}
		for _, id := range ids {
			if id == itemID {
				return ErrSprintConflict
			}
		}
	}
	return nil
}

// sprintWithItems returns the sprint with its living members of the same project, each carrying
// what visibility takes (as the MySQL list and detail do).
func (m *memoryRepo) sprintWithItems(id int64) Sprint {
	s := m.sprints[id]
	ids := m.sprintItems[id]
	items := make([]SprintItem, 0, len(ids))
	for _, iid := range ids {
		c, ok := m.cards[iid]
		if !ok || !m.living(c) || m.cardProjectID(c) != s.ProjectID {
			continue
		}
		items = append(items, SprintItem{ID: c.ID, Number: c.Number, Title: c.Title, ColumnID: c.ColumnID, ViewAccess: c.ViewAccess, EditAccess: c.EditAccess, CreatedByUserID: c.CreatedByUserID})
	}
	s.Items = items
	s.ItemCount = len(items)
	return s
}

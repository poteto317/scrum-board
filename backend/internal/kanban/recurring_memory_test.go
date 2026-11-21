package kanban

import (
	"context"
	"sort"
	"time"
)

func (m *memoryRepo) ensureRecurring() {
	if m.recurringRules == nil {
		m.recurringRules = map[int64]RecurringRule{}
	}
	if m.nextRecurringID == 0 {
		m.nextRecurringID = 1
	}
}

func (m *memoryRepo) ListRecurringRules(_ context.Context, projectID int64) ([]RecurringRule, error) {
	m.ensureRecurring()
	out := []RecurringRule{}
	for _, rule := range m.recurringRules {
		if rule.ProjectID == projectID {
			out = append(out, rule)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (m *memoryRepo) CreateRecurringRule(_ context.Context, projectID int64, in RecurringRuleInput) (RecurringRule, error) {
	m.ensureRecurring()
	fields, err := prepareRecurringCreate(in)
	if err != nil {
		return RecurringRule{}, err
	}
	if projectID <= 0 || !m.validProject(projectID) {
		return RecurringRule{}, ErrProject
	}
	if !m.validColumn(fields.ColumnID) {
		return RecurringRule{}, ErrColumn
	}
	now := time.Now().UTC()
	id := m.nextRecurringID
	m.nextRecurringID++
	rule := RecurringRule{
		ID: id, ProjectID: projectID, Name: fields.Name, Title: fields.Title, Description: fields.Description,
		Cron: fields.Cron, Timezone: fields.Timezone, ColumnID: fields.ColumnID,
		Enabled: *fields.Enabled, CreatedAt: now, UpdatedAt: now,
	}
	m.recurringRules[id] = rule
	return rule, nil
}

func (m *memoryRepo) UpdateRecurringRule(_ context.Context, projectID, id int64, p RecurringRulePatch) (RecurringRule, error) {
	m.ensureRecurring()
	rule, ok := m.recurringRules[id]
	if !ok || rule.ProjectID != projectID {
		return RecurringRule{}, ErrNotFound
	}
	next, err := applyRecurringRulePatch(rule, p)
	if err != nil {
		return RecurringRule{}, err
	}
	if p.ColumnID != nil && !m.validColumn(next.ColumnID) {
		return RecurringRule{}, ErrColumn
	}
	next.UpdatedAt = time.Now().UTC()
	m.recurringRules[id] = next
	return next, nil
}

func (m *memoryRepo) DeleteRecurringRule(_ context.Context, projectID, id int64) error {
	m.ensureRecurring()
	rule, ok := m.recurringRules[id]
	if !ok || rule.ProjectID != projectID {
		return ErrNotFound
	}
	delete(m.recurringRules, id)
	return nil
}

func (m *memoryRepo) RunRecurring(ctx context.Context) (created, skipped, failed int, err error) {
	m.ensureRecurring()
	now := time.Now().UTC()
	ids := make([]int64, 0, len(m.recurringRules))
	for id, rule := range m.recurringRules {
		if rule.Enabled {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		rule, ok := m.recurringRules[id]
		if !ok || !rule.Enabled {
			continue
		}
		fire, fireErr := shouldFire(rule.Cron, rule.Timezone, rule.LastFiredAt, rule.CreatedAt, now)
		if fireErr != nil {
			failed++
			continue
		}
		if !fire {
			skipped++
			continue
		}
		projectID := rule.ProjectID
		_, createErr := m.CreateItem(ctx, ItemInput{
			ColumnID:        rule.ColumnID,
			ProjectID:       &projectID,
			Title:           rule.Title,
			Description:     rule.Description,
			CreatedByUserID: nil,
		})
		if createErr != nil {
			failed++
			continue
		}
		fired := now
		rule.LastFiredAt = &fired
		rule.UpdatedAt = now
		m.recurringRules[id] = rule
		created++
	}
	return created, skipped, failed, nil
}

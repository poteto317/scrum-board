package kanban

import (
	"context"
	"time"
)

func (m *memoryRepo) ListArchivedItems(_ context.Context, projectID int64) ([]Item, error) {
	if projectID <= 0 || !m.projectExists(projectID) {
		return nil, ErrProject
	}
	out := []Item{}
	for _, c := range m.cards {
		if !m.living(c) || c.ArchivedAt == nil || m.cardProjectID(c) != projectID {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

func (m *memoryRepo) ArchiveDoneItems(_ context.Context) (int, error) {
	now := time.Now().UTC()
	cutoff := now.Add(-archiveAfterDone)
	var due []int64
	for _, c := range m.cards {
		if !m.living(c) || c.ArchivedAt != nil || !m.finishedColumn(c.ColumnID) {
			continue
		}
		if c.DoneAt == nil || c.DoneAt.After(cutoff) {
			continue
		}
		due = append(due, c.ID)
	}
	// Stable order by id for batching.
	for i := 0; i < len(due); i++ {
		for j := i + 1; j < len(due); j++ {
			if due[j] < due[i] {
				due[i], due[j] = due[j], due[i]
			}
		}
	}
	archived := 0
	for start := 0; start < len(due); start += archiveBatchSize {
		end := start + archiveBatchSize
		if end > len(due) {
			end = len(due)
		}
		for _, id := range due[start:end] {
			c, ok := m.cards[id]
			if !ok || !m.living(c) || c.ArchivedAt != nil {
				continue
			}
			ts := now
			c.ArchivedAt = &ts
			m.cards[id] = c
			archived++
		}
	}
	return archived, nil
}

func (m *memoryRepo) RestoreArchivedItem(_ context.Context, id, projectID int64) (Item, error) {
	c, ok := m.cards[id]
	if !ok || !m.living(c) || c.ArchivedAt == nil || m.cardProjectID(c) != projectID {
		return Item{}, ErrNotFound
	}
	now := time.Now().UTC()
	c.ArchivedAt = nil
	c.DoneAt = &now
	if !m.finishedColumn(c.ColumnID) {
		c.ColumnID = 3
	}
	c.Position = m.nextPosition(c.ColumnID, projectID)
	c.UpdatedAt = now
	m.cards[id] = c
	return c, nil
}

// finishedColumn reports whether the column is Done or Close (see isFinishedColumnName).
func (m *memoryRepo) finishedColumn(id int64) bool {
	for _, col := range m.columns {
		if col.ID == id {
			return isFinishedColumnName(col.Name)
		}
	}
	return false
}

var _ ArchiveRepository = (*memoryRepo)(nil)

package kanban

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxSprintNameLen = 120
	maxSprintGoalLen = 2000
)

func normalizeSprintName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxSprintNameLen {
		return "", ErrSprint
	}
	return name, nil
}

func normalizeSprintGoal(goal string) (string, error) {
	if !utf8.ValidString(goal) || utf8.RuneCountInString(goal) > maxSprintGoalLen {
		return "", ErrSprint
	}
	return goal, nil
}

func parseSprintDate(s string) (string, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s {
		return "", ErrSprint
	}
	return s, nil
}

func validateSprintDateRange(start, end string) error {
	if start > end {
		return ErrSprint
	}
	return nil
}

// buildFinalSprintItemIDs orders visible IDs first, then retain IDs in previousOrder relative order.
// IDs present in both visible and retain appear once (from visible). Invalid visible IDs return ErrSprint.
func buildFinalSprintItemIDs(previousOrder, visible, retainIDs []int64) ([]int64, error) {
	retainSet := map[int64]struct{}{}
	for _, rid := range retainIDs {
		retainSet[rid] = struct{}{}
	}
	orderedRetain := make([]int64, 0, len(retainIDs))
	for _, pid := range previousOrder {
		if _, ok := retainSet[pid]; ok {
			orderedRetain = append(orderedRetain, pid)
		}
	}
	final := make([]int64, 0, len(visible)+len(orderedRetain))
	seen := map[int64]struct{}{}
	for _, iid := range visible {
		if iid <= 0 {
			return nil, ErrSprint
		}
		if _, dup := seen[iid]; dup {
			return nil, ErrSprint
		}
		seen[iid] = struct{}{}
		final = append(final, iid)
	}
	for _, rid := range orderedRetain {
		if _, dup := seen[rid]; dup {
			continue
		}
		seen[rid] = struct{}{}
		final = append(final, rid)
	}
	return final, nil
}

func (r MySQLRepository) ListSprints(ctx context.Context, projectID int64) ([]Sprint, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, project_id, name, goal, start_date, end_date, status, velocity, created_at, updated_at
FROM sprints WHERE project_id=?
ORDER BY start_date DESC, id DESC`, projectID)
	if err != nil {
		return nil, err
	}
	out := []Sprint{}
	for rows.Next() {
		s, err := scanSprint(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, s)
	}
	err = rows.Err()
	rows.Close() // before the next query: one request must not hold two connections
	if err != nil {
		return nil, err
	}
	ids := make([]int64, len(out))
	for i, s := range out {
		ids[i] = s.ID
	}
	members, err := loadSprintItemsBySprint(ctx, r.DB, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Items = members[out[i].ID]
		out[i].ItemCount = len(out[i].Items)
	}
	return out, nil
}

func (r MySQLRepository) GetSprint(ctx context.Context, id int64) (Sprint, error) {
	return loadSprintFull(ctx, r.DB, id)
}

func (r MySQLRepository) CreateSprint(ctx context.Context, in SprintCreateInput) (Sprint, error) {
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
	if in.ProjectID <= 0 {
		return Sprint{}, ErrProject
	}
	res, err := r.DB.ExecContext(ctx, `
INSERT INTO sprints(project_id, name, goal, start_date, end_date, status, velocity)
VALUES(?,?,?,?,?,?,NULL)`, in.ProjectID, name, goal, start, end, SprintStatusPlanned)
	if err != nil {
		return Sprint{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Sprint{}, err
	}
	return loadSprintFull(ctx, r.DB, id)
}

func (r MySQLRepository) UpdateSprint(ctx context.Context, id int64, p SprintPatch) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
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
	_, err = tx.ExecContext(ctx, `
UPDATE sprints SET name=?, goal=?, start_date=?, end_date=?, velocity=? WHERE id=?`,
		s.Name, s.Goal, s.StartDate, s.EndDate, nullInt(s.Velocity), id)
	if err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) DeleteSprint(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return err
	}
	if s.Status == SprintStatusCompleted {
		return ErrSprintConflict
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM sprints WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r MySQLRepository) ReplaceSprintItems(ctx context.Context, id int64, itemIDs, retainIDs []int64) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	var locked int64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM sprints WHERE id=? FOR UPDATE`, id).Scan(&locked); err != nil {
		return Sprint{}, dbError(err)
	}
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status == SprintStatusCompleted {
		return Sprint{}, ErrSprintConflict
	}
	prevItems, err := loadSprintItems(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	prevOrder := make([]int64, len(prevItems))
	for i, it := range prevItems {
		prevOrder[i] = it.ID
	}
	final, err := buildFinalSprintItemIDs(prevOrder, itemIDs, retainIDs)
	if err != nil {
		return Sprint{}, err
	}
	previousSet := make(map[int64]struct{}, len(prevOrder))
	for _, itemID := range prevOrder {
		previousSet[itemID] = struct{}{}
	}
	finalSet := make(map[int64]struct{}, len(final))
	for _, itemID := range final {
		finalSet[itemID] = struct{}{}
	}
	// Everything the checks need is read (and the items locked) up front: one statement for the
	// items involved and one for the other sprints they already belong to (each repeated per
	// sprintBatchSize items, so the count is fixed up to that many).
	involved := append(append([]int64(nil), prevOrder...), final...)
	states, err := lockSprintMemberStates(ctx, tx, involved)
	if err != nil {
		return Sprint{}, err
	}
	for _, itemID := range prevOrder {
		st, ok := states[itemID]
		if !ok {
			return Sprint{}, dbError(sql.ErrNoRows)
		}
		if st.archived {
			if _, included := finalSet[itemID]; !included {
				final = append(final, itemID)
				finalSet[itemID] = struct{}{}
			}
		}
	}
	elsewhere, err := itemsInOtherOpenSprints(ctx, tx, final, id)
	if err != nil {
		return Sprint{}, err
	}
	for _, iid := range final {
		if _, wasMember := previousSet[iid]; wasMember && states[iid].archived {
			continue
		}
		if err = checkSprintMemberEligible(s, iid, states, elsewhere); err != nil {
			return Sprint{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sprint_items WHERE sprint_id=?`, id); err != nil {
		return Sprint{}, err
	}
	for start := 0; start < len(final); start += sprintBatchSize {
		chunk := final[start:min(start+sprintBatchSize, len(final))]
		args := make([]any, 0, len(chunk)*3)
		for i, iid := range chunk {
			args = append(args, id, iid, start+i)
		}
		values := strings.TrimSuffix(strings.Repeat("(?,?,?),", len(chunk)), ",")
		if _, err = tx.ExecContext(ctx, `INSERT INTO sprint_items(sprint_id, item_id, position) VALUES `+values, args...); err != nil {
			return Sprint{}, err
		}
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) ActivateSprint(ctx context.Context, id int64) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status != SprintStatusPlanned {
		return Sprint{}, ErrSprintConflict
	}
	// Lock planned/active rows in this project before the active conflict check (concurrent activate).
	lockRows, err := tx.QueryContext(ctx, `
SELECT id FROM sprints WHERE project_id=? AND status IN (?, ?) FOR UPDATE`,
		s.ProjectID, SprintStatusPlanned, SprintStatusActive)
	if err != nil {
		return Sprint{}, err
	}
	if err = lockRows.Close(); err != nil {
		return Sprint{}, err
	}
	var other int64
	err = tx.QueryRowContext(ctx, `
SELECT id FROM sprints WHERE project_id=? AND status=? AND id<>? LIMIT 1`,
		s.ProjectID, SprintStatusActive, id).Scan(&other)
	if err == nil {
		return Sprint{}, ErrSprintConflict
	}
	if err != sql.ErrNoRows {
		return Sprint{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sprints SET status=? WHERE id=?`, SprintStatusActive, id); err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) CompleteSprint(ctx context.Context, id int64, velocity *int) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status != SprintStatusActive {
		return Sprint{}, ErrSprintConflict
	}
	if velocity != nil && *velocity < 0 {
		return Sprint{}, ErrSprint
	}
	_, err = tx.ExecContext(ctx, `UPDATE sprints SET status=?, velocity=? WHERE id=?`,
		SprintStatusCompleted, nullInt(velocity), id)
	if err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) CountSprintsForProject(ctx context.Context, projectID int64) (int64, error) {
	var n int64
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sprints WHERE project_id=?`, projectID).Scan(&n)
	return n, err
}

func (r MySQLRepository) DeleteSprintItemsForItem(ctx context.Context, itemID int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM sprint_items WHERE item_id=?`, itemID)
	return err
}

func deleteSprintItemsForItemTx(ctx context.Context, tx *sql.Tx, itemID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM sprint_items WHERE item_id=?`, itemID)
	return err
}

// sprintBatchSize caps the ids (or rows) of one batched statement, which keeps it far below
// MySQL's limit of 65535 placeholders. A variable so a test can make the batches small (1 or more).
var sprintBatchSize = 1000

// sortedUniqueIDs returns ids without duplicates, in ascending order (the order the item rows are
// locked in, so concurrent replacements lock alike).
func sortedUniqueIDs(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.Sort(out)
	return slices.Compact(out)
}

// sprintMemberState is what deciding whether an item may be in a sprint takes.
type sprintMemberState struct {
	projectID int64
	deleted   bool
	archived  bool
}

// lockSprintMemberStates reads and locks the given items, in id order, sprintBatchSize at a time.
// Unknown ids have no entry.
func lockSprintMemberStates(ctx context.Context, tx *sql.Tx, ids []int64) (map[int64]sprintMemberState, error) {
	out := map[int64]sprintMemberState{}
	ids = sortedUniqueIDs(ids)
	for chunk := range slices.Chunk(ids, sprintBatchSize) {
		rows, err := tx.QueryContext(ctx, `
SELECT id, project_id, deleted_at IS NOT NULL, archived_at IS NOT NULL
FROM items WHERE id IN (`+placeholders(len(chunk))+`) ORDER BY id FOR UPDATE`, int64Args(chunk)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			var st sprintMemberState
			if err = rows.Scan(&id, &st.projectID, &st.deleted, &st.archived); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = st
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// itemsInOtherOpenSprints returns which of ids are already in a planned or active sprint other
// than sprintID, sprintBatchSize ids at a time. It is a current (locking) read, not the snapshot the
// transaction started with: a replacement that committed while this one waited for the item rows
// must be seen, or the same item could end up in two sprints.
func itemsInOtherOpenSprints(ctx context.Context, tx *sql.Tx, ids []int64, sprintID int64) (map[int64]struct{}, error) {
	out := map[int64]struct{}{}
	// Sorted and without duplicates: this read locks (FOR SHARE), so it takes its locks in id order.
	for chunk := range slices.Chunk(sortedUniqueIDs(ids), sprintBatchSize) {
		args := append([]any{SprintStatusPlanned, SprintStatusActive, sprintID}, int64Args(chunk)...)
		rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT si.item_id FROM sprint_items si
JOIN sprints s ON s.id=si.sprint_id
WHERE s.status IN (?,?) AND si.sprint_id<>? AND si.item_id IN (`+placeholders(len(chunk))+`) FOR SHARE`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			out[id] = struct{}{}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// checkSprintMemberEligible decides, from what was read up front, whether the item may be in the
// sprint. The checks run in a fixed order, so the first failing one decides the error.
func checkSprintMemberEligible(sprint Sprint, itemID int64, states map[int64]sprintMemberState, elsewhere map[int64]struct{}) error {
	st, ok := states[itemID]
	if !ok || st.deleted {
		return ErrNotFound
	}
	if st.archived {
		return ErrSprintConflict
	}
	if st.projectID != sprint.ProjectID {
		return ErrSprint
	}
	if _, taken := elsewhere[itemID]; taken {
		return ErrSprintConflict
	}
	return nil
}

type sprintQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func loadSprintFull(ctx context.Context, q sprintQuerier, id int64) (Sprint, error) {
	s, err := loadSprintRow(ctx, q, id)
	if err != nil {
		return Sprint{}, err
	}
	items, err := loadSprintItems(ctx, q, id)
	if err != nil {
		return Sprint{}, err
	}
	s.Items = items
	s.ItemCount = len(items)
	return s, nil
}

func loadSprintRow(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id int64) (Sprint, error) {
	row := q.QueryRowContext(ctx, `
SELECT id, project_id, name, goal, start_date, end_date, status, velocity, created_at, updated_at
FROM sprints WHERE id=?`, id)
	return scanSprint(row)
}

// sprintMemberColumns are the columns of a sprint member (see SprintItem); the member's items
// row is aliased c, its number n.
const sprintMemberColumns = "c.id, n.item_number, c.title, c.column_id, c.view_access, c.edit_access, c.created_by_user_id"

// scanSprintItem scans one row of sprintMemberColumns; lead are the destinations of the columns
// selected before them, in the same order as in the SELECT.
func scanSprintItem(rows *sql.Rows, lead ...any) (SprintItem, error) {
	var it SprintItem
	var createdBy sql.NullInt64
	dest := slices.Concat(lead, []any{&it.ID, &it.Number, &it.Title, &it.ColumnID, &it.ViewAccess, &it.EditAccess, &createdBy})
	if err := rows.Scan(dest...); err != nil {
		return SprintItem{}, err
	}
	if createdBy.Valid {
		v := createdBy.Int64
		it.CreatedByUserID = &v
	}
	return it, nil
}

func loadSprintItems(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sprintID int64) ([]SprintItem, error) {
	rows, err := q.QueryContext(ctx, `
SELECT `+sprintMemberColumns+`
FROM sprint_items si
JOIN items c ON c.id=si.item_id
JOIN item_numbers n ON n.item_id=c.id
WHERE si.sprint_id=? AND c.deleted_at IS NULL
  AND c.project_id=(SELECT project_id FROM sprints WHERE id=?)
ORDER BY si.position ASC, c.id ASC`, sprintID, sprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SprintItem{}
	for rows.Next() {
		it, err := scanSprintItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// loadSprintItemsBySprint reads the members of all the given sprints in one statement, in
// position order, keyed by sprint id. A sprint without members has no entry.
func loadSprintItemsBySprint(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sprintIDs []int64) (map[int64][]SprintItem, error) {
	out := map[int64][]SprintItem{}
	for chunk := range slices.Chunk(sprintIDs, sprintBatchSize) {
		rows, err := q.QueryContext(ctx, `
SELECT si.sprint_id, `+sprintMemberColumns+`
FROM sprint_items si
JOIN sprints s ON s.id=si.sprint_id
JOIN items c ON c.id=si.item_id AND c.project_id=s.project_id
JOIN item_numbers n ON n.item_id=c.id
WHERE si.sprint_id IN (`+placeholders(len(chunk))+`) AND c.deleted_at IS NULL
ORDER BY si.sprint_id, si.position ASC, c.id ASC`, int64Args(chunk)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var sprintID int64
			it, err := scanSprintItem(rows, &sprintID)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out[sprintID] = append(out[sprintID], it)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func scanSprint(s scanner) (Sprint, error) {
	var sp Sprint
	var start, end time.Time
	var vel sql.NullInt64
	var status string
	err := s.Scan(&sp.ID, &sp.ProjectID, &sp.Name, &sp.Goal, &start, &end, &status, &vel, &sp.CreatedAt, &sp.UpdatedAt)
	if err != nil {
		return Sprint{}, dbError(err)
	}
	sp.StartDate = start.Format("2006-01-02")
	sp.EndDate = end.Format("2006-01-02")
	sp.Status = SprintStatus(status)
	if vel.Valid {
		v := int(vel.Int64)
		sp.Velocity = &v
	}
	return sp, nil
}

func nullInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

package kanban

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"
)

// resolveActiveProjectID returns raw when that project exists.
// Otherwise it returns the project with the lowest position, breaking ties by id.
// An empty list resolves to 0. The lookup does not depend on the display name.
func resolveActiveProjectID(raw int64, projects []Project) int64 {
	if raw > 0 && projectIDExists(projects, raw) {
		return raw
	}
	if len(projects) == 0 {
		return 0
	}
	best := projects[0]
	for _, p := range projects[1:] {
		if p.Position < best.Position || (p.Position == best.Position && p.ID < best.ID) {
			best = p
		}
	}
	return best.ID
}

func projectIDExists(projects []Project, id int64) bool {
	for _, p := range projects {
		if p.ID == id {
			return true
		}
	}
	return false
}

// resolveCreateProjectID picks ItemInput.ProjectID when set, otherwise the resolved active.
func resolveCreateProjectID(in ItemInput, settings BoardSettings, projects []Project) (int64, error) {
	if in.ProjectID != nil {
		id := *in.ProjectID
		if id <= 0 || !projectIDExists(projects, id) {
			return 0, ErrProject
		}
		return id, nil
	}
	id := resolveActiveProjectID(settings.ActiveProjectID, projects)
	if id <= 0 {
		return 0, ErrProject
	}
	return id, nil
}

// repositionItemForProjectChange sets position and backlogPosition (and free offsetY) at the destination end.
func repositionItemForProjectChange(ctx context.Context, tx *sql.Tx, c *Item) error {
	nextPos, err := nextCardPosition(ctx, tx, c.ColumnID, c.ProjectID)
	if err != nil {
		return err
	}
	nextBacklog, err := nextBacklogPosition(ctx, tx, c.ProjectID)
	if err != nil {
		return err
	}
	c.Position = nextPos
	c.BacklogPosition = nextBacklog
	layout, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return err
	}
	if layout.CardLayout == CardLayoutFree {
		offsetY, err := nextFreeOffsetY(ctx, tx, c.ColumnID, c.ProjectID)
		if err != nil {
			return err
		}
		c.OffsetY = offsetY
	}
	return nil
}

func normalizeProjectName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 80 {
		return "", ErrProject
	}
	return name, nil
}

type settingsQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func listProjects(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}) ([]Project, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name, position, created_at, updated_at FROM projects ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		var p Project
		if err = rows.Scan(&p.ID, &p.Name, &p.Position, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return projects, nil
}

func resolvedActiveProjectID(ctx context.Context, q settingsQuery) (int64, error) {
	projects, err := listProjects(ctx, q)
	if err != nil {
		return 0, err
	}
	settings, err := loadBoardSettings(ctx, q)
	if err != nil {
		return 0, err
	}
	return resolveActiveProjectID(settings.ActiveProjectID, projects), nil
}

func (r MySQLRepository) ListProjects(ctx context.Context) ([]Project, error) {
	return listProjects(ctx, r.DB)
}

func (r MySQLRepository) CreateProject(ctx context.Context, name string) (Project, error) {
	name, err := normalizeProjectName(name)
	if err != nil {
		return Project{}, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT position FROM projects ORDER BY id FOR UPDATE`)
	if err != nil {
		return Project{}, err
	}
	maxPos := -1
	for rows.Next() {
		var pos int
		if err = rows.Scan(&pos); err != nil {
			rows.Close()
			return Project{}, err
		}
		if pos > maxPos {
			maxPos = pos
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return Project{}, err
	}
	rows.Close()
	res, err := tx.ExecContext(ctx, `INSERT INTO projects(name, position) VALUES(?, ?)`, name, maxPos+1)
	if err != nil {
		return Project{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Project{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT IGNORE INTO item_number_sequence(project_id, next_number) VALUES(?, 1)`, id); err != nil {
		return Project{}, err
	}
	p, err := loadProject(ctx, tx, id)
	if err != nil {
		return Project{}, err
	}
	if err = tx.Commit(); err != nil {
		return Project{}, err
	}
	return p, nil
}

func (r MySQLRepository) UpdateProject(ctx context.Context, id int64, name string) (Project, error) {
	name, err := normalizeProjectName(name)
	if err != nil {
		return Project{}, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback()
	var locked int64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM projects WHERE id=? FOR UPDATE`, id).Scan(&locked); err != nil {
		return Project{}, dbError(err)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE projects SET name=? WHERE id=?`, name, id); err != nil {
		return Project{}, err
	}
	p, err := loadProject(ctx, tx, id)
	if err != nil {
		return Project{}, err
	}
	if err = tx.Commit(); err != nil {
		return Project{}, err
	}
	return p, nil
}

func (r MySQLRepository) DeleteProject(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = assertProjectDeletable(ctx, tx, id); err != nil {
		return err
	}
	// Sequence FK blocks project DELETE; remove the per-project counter first.
	if _, err = tx.ExecContext(ctx, `DELETE FROM item_number_sequence WHERE project_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM projects WHERE id=?`, id); err != nil {
		return dbError(err)
	}
	return tx.Commit()
}

// assertProjectDeletable locks project rows and returns ErrNotFound / ErrProjectConflict.
func assertProjectDeletable(ctx context.Context, tx *sql.Tx, id int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM projects ORDER BY id FOR UPDATE`)
	if err != nil {
		return err
	}
	var ids []int64
	found := false
	for rows.Next() {
		var pid int64
		if err = rows.Scan(&pid); err != nil {
			rows.Close()
			return err
		}
		if pid == id {
			found = true
		}
		ids = append(ids, pid)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if !found {
		return ErrNotFound
	}
	var items int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM items WHERE project_id=?`, id).Scan(&items); err != nil {
		return err
	}
	if items > 0 || len(ids) <= 1 {
		return ErrProjectConflict
	}
	return nil
}

func loadProject(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id int64) (Project, error) {
	var p Project
	err := q.QueryRowContext(ctx, `SELECT id, name, position, created_at, updated_at FROM projects WHERE id=?`, id).Scan(
		&p.ID, &p.Name, &p.Position, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return Project{}, dbError(err)
	}
	return p, nil
}

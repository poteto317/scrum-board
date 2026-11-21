package kanban

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

func TestInitializeProjectsSeedsMainAndKeepsItemIdentity(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	type ident struct {
		id      int64
		created string
	}
	readItems := func() []ident {
		t.Helper()
		rows, err := db.Query(`SELECT id, CAST(created_at AS CHAR) FROM items ORDER BY id`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []ident
		for rows.Next() {
			var row ident
			if err = rows.Scan(&row.id, &row.created); err != nil {
				t.Fatal(err)
			}
			out = append(out, row)
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := readItems()
	if len(before) == 0 {
		t.Fatal("seed item missing")
	}
	mustExec(t, db, `ALTER TABLE items DROP FOREIGN KEY fk_item_project`)
	mustExec(t, db, `ALTER TABLE items DROP INDEX items_project_position`)
	mustExec(t, db, `ALTER TABLE items DROP COLUMN project_id`)
	mustExec(t, db, `DROP TABLE IF EXISTS item_number_sequence`)
	mustExec(t, db, `DROP TABLE IF EXISTS item_numbers`)
	mustExec(t, db, `DROP TABLE projects`)

	if err := r.InitializeProjects(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	var id int64
	var name string
	if err := db.QueryRow(`SELECT COUNT(*) FROM projects`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT id, name FROM projects ORDER BY position, id LIMIT 1`).Scan(&id, &name); err != nil {
		t.Fatal(err)
	}
	if count != 1 || name != "メイン" || id <= 0 {
		t.Fatalf("seed project: count=%d id=%d name=%q", count, id, name)
	}
	after := readItems()
	if len(after) != len(before) {
		t.Fatalf("item count %d want %d", len(after), len(before))
	}
	for i := range before {
		if after[i].id != before[i].id || after[i].created != before[i].created {
			t.Fatalf("identity changed: before %+v after %+v", before[i], after[i])
		}
		var projectID int64
		if err := db.QueryRow(`SELECT project_id FROM items WHERE id=?`, after[i].id).Scan(&projectID); err != nil || projectID != id {
			t.Fatalf("item %d project=%d want %d err=%v", after[i].id, projectID, id, err)
		}
	}
	if err := r.InitializeProjects(ctx); err != nil {
		t.Fatal(err)
	}
	var id2 int64
	var count2 int
	if err := db.QueryRow(`SELECT COUNT(*) FROM projects`).Scan(&count2); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT id FROM projects ORDER BY position, id LIMIT 1`).Scan(&id2); err != nil {
		t.Fatal(err)
	}
	if count2 != 1 || id2 != id {
		t.Fatalf("re-run changed project: count=%d id=%d want %d", count2, id2, id)
	}
	rerun := readItems()
	for i := range before {
		if rerun[i] != before[i] {
			t.Fatalf("re-run changed item: %+v want %+v", rerun[i], before[i])
		}
	}
}

func TestProjectScopeAndMoveMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	if _, err := r.CreateProject(ctx, " "); !errors.Is(err, ErrProject) {
		t.Fatalf("blank: %v", err)
	}
	if _, err := r.CreateProject(ctx, strings.Repeat("a", 81)); !errors.Is(err, ErrProject) {
		t.Fatalf("long: %v", err)
	}
	other, err := r.CreateProject(ctx, "  other  ")
	if err != nil || other.Name != "other" {
		t.Fatalf("create: %+v %v", other, err)
	}
	renamed, err := r.UpdateProject(ctx, other.ID, " 次 ")
	if err != nil || renamed.Name != "次" || renamed.ID != other.ID {
		t.Fatalf("rename: %+v %v", renamed, err)
	}
	projects, err := r.ListProjects(ctx)
	if err != nil || len(projects) != 2 || projects[0].Name != "メイン" || projects[1].ID != other.ID {
		t.Fatalf("list: %+v %v", projects, err)
	}

	mainItem, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "main-card"})
	if err != nil {
		t.Fatal(err)
	}
	if mainItem.ProjectID != projects[0].ID {
		t.Fatalf("nil projectId: %+v", mainItem)
	}
	explicit, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "other-card", ProjectID: &other.ID})
	if err != nil || explicit.ProjectID != other.ID {
		t.Fatalf("explicit: %+v %v", explicit, err)
	}
	bad := int64(99999)
	if _, err = r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "nope", ProjectID: &bad}); !errors.Is(err, ErrProject) {
		t.Fatalf("bad project: %v", err)
	}
	if err = r.DeleteProject(ctx, projects[0].ID); !errors.Is(err, ErrProjectConflict) {
		t.Fatalf("delete with items: %v", err)
	}
	empty, err := r.CreateProject(ctx, "empty")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteProject(ctx, empty.ID); err != nil {
		t.Fatal(err)
	}
	again, err := r.CreateProject(ctx, "empty")
	if err != nil || again.ID == empty.ID {
		t.Fatalf("L-455: old=%d new=%+v %v", empty.ID, again, err)
	}
	if err = r.DeleteProject(ctx, again.ID); err != nil {
		t.Fatal(err)
	}

	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !containsID(board.Items, mainItem.ID) || containsID(board.Items, explicit.ID) {
		t.Fatalf("board filter: %+v", idsOf(board.Items))
	}
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !containsID(backlog, mainItem.ID) || containsID(backlog, explicit.ID) {
		t.Fatalf("backlog filter: %+v", idsOf(backlog))
	}

	var otherPos int
	if err = db.QueryRow(`SELECT position FROM items WHERE id=?`, explicit.ID).Scan(&otherPos); err != nil {
		t.Fatal(err)
	}
	var mainIDs []int64
	for _, item := range board.Items {
		if item.ColumnID == 1 {
			mainIDs = append(mainIDs, item.ID)
		}
	}
	if len(mainIDs) < 2 {
		t.Fatalf("need seed + created in column 1: %+v", board.Items)
	}
	reversed := append([]int64(nil), mainIDs...)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	if _, err = r.ReorderItems(ctx, []ItemColumnOrder{{ColumnID: 1, ItemIDs: reversed}}); err != nil {
		t.Fatal(err)
	}
	var otherPosAfter int
	if err = db.QueryRow(`SELECT position FROM items WHERE id=?`, explicit.ID).Scan(&otherPosAfter); err != nil || otherPosAfter != otherPos {
		t.Fatalf("other position %d -> %d err=%v", otherPos, otherPosAfter, err)
	}
	withForeign := append(append([]int64{}, reversed...), explicit.ID)
	if _, err = r.ReorderItems(ctx, []ItemColumnOrder{{ColumnID: 1, ItemIDs: withForeign}}); !errors.Is(err, ErrItemOrderMismatch) {
		t.Fatalf("foreign reorder: %v", err)
	}
	if _, err = r.ReorderItems(ctx, []ItemColumnOrder{{ColumnID: 1, ItemIDs: reversed[:len(reversed)-1]}}); !errors.Is(err, ErrItemOrderMismatch) {
		t.Fatalf("missing reorder: %v", err)
	}
	backlogIDs := make([]int64, len(backlog))
	for i, item := range backlog {
		backlogIDs[i] = item.ID
	}
	if _, err = r.ReorderBacklog(ctx, append(backlogIDs, explicit.ID)); !errors.Is(err, ErrBacklogMismatch) {
		t.Fatalf("backlog foreign: %v", err)
	}

	var siblingPos, siblingBacklog int
	siblingID := mainIDs[0]
	if siblingID == mainItem.ID && len(mainIDs) > 1 {
		siblingID = mainIDs[1]
	}
	if err = db.QueryRow(`SELECT position, backlog_position FROM items WHERE id=?`, siblingID).Scan(&siblingPos, &siblingBacklog); err != nil {
		t.Fatal(err)
	}
	moved, err := r.UpdateItem(ctx, mainItem.ID, ItemPatch{ProjectID: &other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if moved.ProjectID != other.ID || moved.Position != otherPos+1 {
		t.Fatalf("moved to end: %+v otherPos=%d", moved, otherPos)
	}
	var siblingPos2, siblingBacklog2 int
	if err = db.QueryRow(`SELECT position, backlog_position FROM items WHERE id=?`, siblingID).Scan(&siblingPos2, &siblingBacklog2); err != nil {
		t.Fatal(err)
	}
	if siblingPos2 != siblingPos || siblingBacklog2 != siblingBacklog {
		t.Fatalf("source compacted: pos %d->%d backlog %d->%d", siblingPos, siblingPos2, siblingBacklog, siblingBacklog2)
	}

	active := other.ID
	settings, items, err := r.PatchBoardSettings(ctx, BoardSettingsPatch{ActiveProjectID: &active})
	if err != nil || items != nil || settings.ActiveProjectID != other.ID {
		t.Fatalf("patch active: %+v items=%v err=%v", settings, items, err)
	}
	var raw string
	if err = db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='active_project_id'`).Scan(&raw); err != nil || raw != itoa(other.ID) {
		t.Fatalf("raw active=%q err=%v", raw, err)
	}
	board, err = r.Board(ctx)
	if err != nil || board.Settings.ActiveProjectID != other.ID || !containsID(board.Items, explicit.ID) || !containsID(board.Items, mainItem.ID) {
		t.Fatalf("switched board: %+v items=%v err=%v", board.Settings, idsOf(board.Items), err)
	}
}

func TestActiveProjectSettingsMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	mustExec(t, db, `INSERT INTO board_settings(setting_key, setting_value) VALUES('theme','dark')
 ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`)
	mustExec(t, db, `UPDATE board_settings SET setting_value='999' WHERE setting_key='active_project_id'`)

	var layoutBefore, mobileBefore string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='card_layout'`).Scan(&layoutBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key='mobile_board_column_id'`).Scan(&mobileBefore); err != nil {
		t.Fatal(err)
	}

	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	projects, err := r.ListProjects(ctx)
	if err != nil || len(projects) == 0 {
		t.Fatal(err)
	}
	if board.Settings.ActiveProjectID != projects[0].ID {
		t.Fatalf("resolved %d want %d", board.Settings.ActiveProjectID, projects[0].ID)
	}
	raw := settingValue(t, db, "active_project_id")
	if raw != "999" {
		t.Fatalf("GET wrote raw %q", raw)
	}
	if settingValue(t, db, "theme") != "dark" {
		t.Fatal("GET dropped unknown key")
	}

	layout := CardLayoutFree
	settings, items, err := r.PatchBoardSettings(ctx, BoardSettingsPatch{CardLayout: &layout})
	if err != nil {
		t.Fatal(err)
	}
	if items != nil || settings.CardLayout != CardLayoutFree || settings.ActiveProjectID != projects[0].ID {
		t.Fatalf("layout response: %+v items=%v", settings, items)
	}
	if settingValue(t, db, "active_project_id") != "999" {
		t.Fatal("layout patch healed active")
	}
	if settingValue(t, db, "mobile_board_column_id") != mobileBefore {
		t.Fatal("layout patch changed mobile")
	}
	if settingValue(t, db, "theme") != "dark" {
		t.Fatal("layout patch dropped unknown key")
	}

	other, err := r.CreateProject(ctx, "second")
	if err != nil {
		t.Fatal(err)
	}
	settings, items, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{ActiveProjectID: &other.ID})
	if err != nil || items != nil || settings.ActiveProjectID != other.ID || settings.CardLayout != CardLayoutFree {
		t.Fatalf("active patch: %+v items=%v err=%v", settings, items, err)
	}
	if settingValue(t, db, "active_project_id") != itoa(other.ID) {
		t.Fatalf("raw not healed: %s", settingValue(t, db, "active_project_id"))
	}
	if settingValue(t, db, "card_layout") != CardLayoutFree || settingValue(t, db, "mobile_board_column_id") != mobileBefore {
		t.Fatal("active patch changed other settings")
	}
	board, err = r.Board(ctx)
	if err != nil || board.Settings.ActiveProjectID != other.ID {
		t.Fatalf("reload: %+v %v", board.Settings, err)
	}

	zero := int64(0)
	if _, _, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{ActiveProjectID: &zero}); !errors.Is(err, ErrBoardSettings) {
		t.Fatalf("zero: %v", err)
	}
	missing := int64(99999)
	if _, _, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{ActiveProjectID: &missing}); !errors.Is(err, ErrBoardSettings) {
		t.Fatalf("missing: %v", err)
	}
	if settingValue(t, db, "theme") != "dark" {
		t.Fatal("failed patch dropped unknown key")
	}

	empty, err := r.CreateProject(ctx, "empty")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{ActiveProjectID: &empty.ID}); err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteProject(ctx, empty.ID); err != nil {
		t.Fatal(err)
	}
	if settingValue(t, db, "active_project_id") != itoa(empty.ID) {
		t.Fatal("delete rewrote raw active")
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if board.Settings.ActiveProjectID != projects[0].ID {
		t.Fatalf("fallback %d want %d", board.Settings.ActiveProjectID, projects[0].ID)
	}
	if settingValue(t, db, "active_project_id") != itoa(empty.ID) {
		t.Fatal("GET after delete rewrote raw")
	}
}

func TestFreeToPackReassignsPerProjectMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	other, err := r.CreateProject(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	mainCard, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "main-a"})
	if err != nil {
		t.Fatal(err)
	}
	otherID := other.ID
	otherCard, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "other-a", ProjectID: &otherID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `UPDATE items SET offset_y=?, position=? WHERE id=?`, 100, 5, mainCard.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `UPDATE items SET offset_y=?, position=? WHERE id=?`, 50, 9, otherCard.ID); err != nil {
		t.Fatal(err)
	}
	free := CardLayoutFree
	if _, _, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{CardLayout: &free}); err != nil {
		t.Fatal(err)
	}
	pack := CardLayoutPack
	if _, _, err = r.PatchBoardSettings(ctx, BoardSettingsPatch{CardLayout: &pack}); err != nil {
		t.Fatal(err)
	}
	var mainPos, otherPos int
	if err = db.QueryRowContext(ctx, `SELECT position FROM items WHERE id=?`, mainCard.ID).Scan(&mainPos); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, `SELECT position FROM items WHERE id=?`, otherCard.ID).Scan(&otherPos); err != nil {
		t.Fatal(err)
	}
	// Each project×column is renumbered independently; other project's position must not
	// absorb main's cards into one shared sequence.
	if mainPos < 0 || otherPos < 0 {
		t.Fatalf("positions main=%d other=%d", mainPos, otherPos)
	}
	var mixed int
	if err = db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM items a JOIN items b ON a.column_id=b.column_id AND a.project_id<>b.project_id AND a.position=b.position
 WHERE a.id=? OR b.id=?`, mainCard.ID, otherCard.ID).Scan(&mixed); err != nil {
		t.Fatal(err)
	}
	// Same position across projects is fine; collision within a project would be the bug.
	_ = mixed
	var mainCount, otherCount int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM items WHERE project_id=? AND column_id=1`, mainCard.ProjectID).Scan(&mainCount)
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM items WHERE project_id=? AND column_id=1`, otherID).Scan(&otherCount)
	if err = db.QueryRowContext(ctx, `SELECT position FROM items WHERE id=?`, otherCard.ID).Scan(&otherPos); err != nil {
		t.Fatal(err)
	}
	// other project has only otherCard in todo after seed may also be in main — ensure otherCard
	// position is within its project set (0..otherCount-1) and main card stayed in main project.
	if otherPos >= otherCount {
		t.Fatalf("other position %d out of project set size %d (cross-project reassign?)", otherPos, otherCount)
	}
	gotMain, err := r.GetItem(ctx, mainCard.ID)
	if err != nil || gotMain.ProjectID != mainCard.ProjectID {
		t.Fatalf("main project changed: %+v %v", gotMain, err)
	}
}

func settingValue(t *testing.T, db *sql.DB, key string) string {
	t.Helper()
	var value string
	if err := db.QueryRow(`SELECT setting_value FROM board_settings WHERE setting_key=?`, key).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestMySQLDeleteProjectClearsSprintsWhenNoItems(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	p, err := r.CreateProject(ctx, "with-sprint")
	if err != nil {
		t.Fatal(err)
	}
	s, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "S", StartDate: "2026-11-01", EndDate: "2026-11-14", ProjectID: p.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.CompleteSprint(ctx, s.ID, nil); !errors.Is(err, ErrSprintConflict) {
		t.Fatalf("complete planned: %v", err)
	}
	if _, err = r.ActivateSprint(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CompleteSprint(ctx, s.ID, nil); err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteProject(ctx, p.ID); err != nil {
		t.Fatalf("delete with completed sprint: %v", err)
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM sprints WHERE project_id=?`, p.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("sprints left: n=%d err=%v", n, err)
	}
}

func containsID(items []Item, id int64) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func idsOf(items []Item) []int64 {
	ids := make([]int64, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids
}

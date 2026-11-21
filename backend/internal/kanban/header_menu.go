package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
)

// PageHeaderMenu is one page kind's hidden menu item IDs.
type PageHeaderMenu struct {
	HiddenIDs []string `json:"hiddenIds"`
}

// WorkspaceHeaderMenu holds board, backlog, and itemDetail menu prefs.
type WorkspaceHeaderMenu struct {
	Board      PageHeaderMenu `json:"board"`
	Backlog    PageHeaderMenu `json:"backlog"`
	ItemDetail PageHeaderMenu `json:"itemDetail"`
}

var (
	boardBacklogHeaderMenuIDs = map[string]struct{}{
		"project_add":    {},
		"project_rename": {},
		"project_delete": {},
		"open_trash":     {},
		"open_users":     {},
		"open_recurring": {},
		"open_settings":  {},
	}
	itemDetailHeaderMenuIDs = map[string]struct{}{
		"open_trash":     {},
		"open_users":     {},
		"open_recurring": {},
		"open_settings":  {},
		"item_history":   {},
		"item_solution":  {},
		"item_favorite":  {},
	}
)

func emptyPageHeaderMenu() PageHeaderMenu {
	return PageHeaderMenu{HiddenIDs: []string{}}
}

func emptyWorkspaceHeaderMenu() WorkspaceHeaderMenu {
	return WorkspaceHeaderMenu{
		Board:      emptyPageHeaderMenu(),
		Backlog:    emptyPageHeaderMenu(),
		ItemDetail: emptyPageHeaderMenu(),
	}
}

func clonePageHeaderMenu(in PageHeaderMenu) PageHeaderMenu {
	out := PageHeaderMenu{HiddenIDs: []string{}}
	if in.HiddenIDs != nil {
		out.HiddenIDs = append([]string(nil), in.HiddenIDs...)
	}
	return out
}

func cloneWorkspaceHeaderMenu(in WorkspaceHeaderMenu) WorkspaceHeaderMenu {
	return WorkspaceHeaderMenu{
		Board:      clonePageHeaderMenu(in.Board),
		Backlog:    clonePageHeaderMenu(in.Backlog),
		ItemDetail: clonePageHeaderMenu(in.ItemDetail),
	}
}

func normalizePageHeaderMenuPut(in PageHeaderMenu) PageHeaderMenu {
	seen := make(map[string]struct{}, len(in.HiddenIDs))
	out := make([]string, 0, len(in.HiddenIDs))
	for _, id := range in.HiddenIDs {
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return PageHeaderMenu{HiddenIDs: out}
}

func normalizeGetWorkspaceHeaderMenu(in WorkspaceHeaderMenu) WorkspaceHeaderMenu {
	return WorkspaceHeaderMenu{
		Board:      normalizePageHeaderMenuGet(in.Board, boardBacklogHeaderMenuIDs),
		Backlog:    normalizePageHeaderMenuGet(in.Backlog, boardBacklogHeaderMenuIDs),
		ItemDetail: normalizePageHeaderMenuGet(in.ItemDetail, itemDetailHeaderMenuIDs),
	}
}

func normalizePageHeaderMenuGet(in PageHeaderMenu, catalog map[string]struct{}) PageHeaderMenu {
	if in.HiddenIDs == nil {
		return emptyPageHeaderMenu()
	}
	seen := make(map[string]struct{}, len(in.HiddenIDs))
	out := make([]string, 0, len(in.HiddenIDs))
	for _, id := range in.HiddenIDs {
		if _, ok := catalog[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return PageHeaderMenu{HiddenIDs: out}
}

// parseStoredHeaderMenuPayload maps DB JSON to WorkspaceHeaderMenu for GET normalization.
func parseStoredHeaderMenuPayload(payload []byte) WorkspaceHeaderMenu {
	empty := emptyWorkspaceHeaderMenu()
	if len(payload) == 0 {
		return empty
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(payload, &top); err != nil {
		return empty
	}
	out := emptyWorkspaceHeaderMenu()
	if raw, ok := top["board"]; ok {
		out.Board = parseOnePageHeaderMenuGet(raw, boardBacklogHeaderMenuIDs)
	}
	if raw, ok := top["backlog"]; ok {
		out.Backlog = parseOnePageHeaderMenuGet(raw, boardBacklogHeaderMenuIDs)
	}
	if raw, ok := top["itemDetail"]; ok {
		out.ItemDetail = parseOnePageHeaderMenuGet(raw, itemDetailHeaderMenuIDs)
	}
	return out
}

func parseOnePageHeaderMenuGet(raw json.RawMessage, catalog map[string]struct{}) PageHeaderMenu {
	if string(raw) == "null" {
		return emptyPageHeaderMenu()
	}
	var body struct {
		HiddenIDs json.RawMessage `json:"hiddenIds"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return emptyPageHeaderMenu()
	}
	if len(body.HiddenIDs) == 0 {
		return emptyPageHeaderMenu()
	}
	if string(body.HiddenIDs) == "null" {
		return emptyPageHeaderMenu()
	}
	var rawIDs []any
	if err := json.Unmarshal(body.HiddenIDs, &rawIDs); err != nil {
		return emptyPageHeaderMenu()
	}
	ids := make([]string, 0, len(rawIDs))
	for _, v := range rawIDs {
		s, ok := v.(string)
		if !ok {
			continue
		}
		ids = append(ids, s)
	}
	return normalizePageHeaderMenuGet(PageHeaderMenu{HiddenIDs: ids}, catalog)
}

func (r MySQLRepository) GetHeaderMenu(ctx context.Context) (WorkspaceHeaderMenu, error) {
	var payload []byte
	err := r.DB.QueryRowContext(ctx, `SELECT payload FROM workspace_header_menu WHERE id = 1`).Scan(&payload)
	if err == sql.ErrNoRows {
		return emptyWorkspaceHeaderMenu(), nil
	}
	if err != nil {
		return WorkspaceHeaderMenu{}, err
	}
	return parseStoredHeaderMenuPayload(payload), nil
}

func (r MySQLRepository) PutHeaderMenu(ctx context.Context, in WorkspaceHeaderMenu) (WorkspaceHeaderMenu, error) {
	out := WorkspaceHeaderMenu{
		Board:      normalizePageHeaderMenuPut(in.Board),
		Backlog:    normalizePageHeaderMenuPut(in.Backlog),
		ItemDetail: normalizePageHeaderMenuPut(in.ItemDetail),
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return WorkspaceHeaderMenu{}, err
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO workspace_header_menu (id, payload)
VALUES (1, CAST(? AS JSON))
ON DUPLICATE KEY UPDATE payload = VALUES(payload)`, string(raw))
	if err != nil {
		return WorkspaceHeaderMenu{}, err
	}
	return out, nil
}
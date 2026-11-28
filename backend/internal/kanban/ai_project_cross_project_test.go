package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestSearchViewableItemsFindsOtherProject(t *testing.T) {
	f := newToolFixture(t)
	here := f.item(t, ItemInput{Title: "CROSS-HERE unique"})
	otherID := f.other.ID
	there, err := f.repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "CROSS-THERE unique", ProjectID: &otherID})
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := f.repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "CROSS-HIDDEN unique", Description: "SECRET-CROSS", ProjectID: &otherID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.ReplaceItemACL(context.Background(), hidden.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	viewer := itemSearchViewer(&f.admin)
	onlyHere, err := f.repo.SearchProjectItems(context.Background(), 1, ItemSearch{Terms: []string{"unique"}, Viewer: viewer})
	if err != nil {
		t.Fatal(err)
	}
	if len(onlyHere) != 1 || onlyHere[0].ID != here.ID {
		t.Fatalf("project search: %+v", onlyHere)
	}
	all, err := f.repo.SearchViewableItems(context.Background(), ItemSearch{Terms: []string{"unique"}, Viewer: viewer})
	if err != nil {
		t.Fatal(err)
	}
	ids := map[int64]bool{}
	for _, it := range all {
		ids[it.ID] = true
	}
	if !ids[here.ID] || !ids[there.ID] || !ids[hidden.ID] {
		t.Fatalf("admin cross search: %+v", all)
	}
	memberAll, err := f.repo.SearchViewableItems(context.Background(), ItemSearch{Terms: []string{"unique"}, Viewer: itemSearchViewer(&f.member)})
	if err != nil {
		t.Fatal(err)
	}
	memberIDs := map[int64]bool{}
	for _, it := range memberAll {
		memberIDs[it.ID] = true
	}
	if !memberIDs[here.ID] || !memberIDs[there.ID] || memberIDs[hidden.ID] {
		t.Fatalf("member must not see restricted: %+v", memberAll)
	}
}

func TestCrossProjectSearchItemsAndGetItem(t *testing.T) {
	f := newToolFixture(t)
	otherID := f.other.ID
	there, err := f.repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "ZZCROSS other", Description: "body", ProjectID: &otherID})
	if err != nil {
		t.Fatal(err)
	}
	off := f.exec(f.admin, 1)
	_, nums := searchNumbers(t, off, `{"query":"zzcross"}`)
	if len(nums) != 0 {
		t.Fatalf("off must not see other project: %v", nums)
	}
	on := f.execCross(f.admin, 1, true)
	out, nums := searchNumbers(t, on, `{"query":"zzcross"}`)
	if len(nums) != 1 || nums[0] != there.Number || out.Items[0].ProjectID != otherID {
		t.Fatalf("on search: %+v nums=%v", out, nums)
	}
	if got := runTool(t, on, toolGetItem, `{"number":1}`); !strings.Contains(got, toolErrInvalidInput) {
		t.Fatalf("get without projectId: %s", got)
	}
	got := runTool(t, on, toolGetItem, fmt.Sprintf(`{"number":%d,"projectId":%d}`, there.Number, otherID))
	var item getItemOut
	if err := json.Unmarshal([]byte(got), &item); err != nil || item.ProjectID != otherID || item.Number != there.Number {
		t.Fatalf("get: %s err=%v", got, err)
	}
}

func TestCrossProjectProposeOtherOnlyNumberNotFound(t *testing.T) {
	f := newToolFixture(t)
	otherID := f.other.ID
	there, err := f.repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "only-elsewhere", ProjectID: &otherID})
	if err != nil {
		t.Fatal(err)
	}
	e := f.execCross(f.admin, 1, true)
	got := runTool(t, e, toolProposeStatusChange, fmt.Sprintf(`{"number":%d,"status":"Doing"}`, there.Number))
	if !strings.Contains(got, toolErrItemNotFound) {
		t.Fatalf("propose: %s", got)
	}
}

func TestCrossProjectReadDescriptionDoesNotSatisfyURLPropose(t *testing.T) {
	f := newToolFixture(t)
	otherID := f.other.ID
	// Same number possible across projects: create URL item #? and other with description.
	urlItem := f.item(t, ItemInput{Title: "url-side", Description: "URL-DESC"})
	there, err := f.repo.CreateItem(context.Background(), ItemInput{
		ColumnID: 1, Title: "other-side", Description: "OTHER-DESC-FULL", ProjectID: &otherID,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Force same number by creating until match is unlikely; instead use URL item number after reading other.
	e := f.execCross(f.admin, 1, true)
	_ = runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d,"projectId":%d}`, there.Number, otherID))
	got := runTool(t, e, toolProposeDescriptionEdit, fmt.Sprintf(
		`{"number":%d,"description":"replacement whole text here"}`, urlItem.Number))
	if !strings.Contains(got, toolErrDescriptionNotRead) {
		t.Fatalf("must not propose from other-project read: %s", got)
	}
}

func TestCrossProjectSearchRepoFailureStops(t *testing.T) {
	f := newToolFixture(t)
	boom := errors.New("SELECT failed SENTINEL")
	repo := &failingToolRepo{memoryRepo: f.repo, searchErr: boom}
	e := newProjectToolExecutor(repo, 1, &f.admin, f.repo.sortedColumns(), f.repo.labels, true, nil)
	out, err := e.Run(context.Background(), ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{"query":"x"}`)})
	if !errors.Is(err, boom) || out != "" {
		t.Fatalf("out=%q err=%v", out, err)
	}
}

func TestBuildProjectChatSystemCrossSection(t *testing.T) {
	now := time.Now()
	off := buildProjectChatSystem("p", now, nil, nil, nil, false)
	on := buildProjectChatSystem("p", now, nil, nil, nil, true)
	if strings.Contains(off, "横断検索がオン") {
		t.Fatal("off must not mention cross search")
	}
	if !strings.Contains(on, "横断検索がオン") {
		t.Fatal("on must mention cross search")
	}
}

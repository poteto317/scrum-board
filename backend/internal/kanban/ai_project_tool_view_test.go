package kanban

import (
	"testing"
	"time"
)

func TestRestrictedItemIDs(t *testing.T) {
	items := []Item{
		{ID: 1, ViewAccess: ViewAccessOpen}, {ID: 2, ViewAccess: ViewAccessRestricted},
		{ID: 3, ViewAccess: ViewAccessPublic}, {ID: 4, ViewAccess: ViewAccessRestricted},
	}
	got := restrictedItemIDs(items)
	if len(got) != 2 || got[0] != 2 || got[1] != 4 {
		t.Fatalf("got %v", got)
	}
	if got := restrictedItemIDs(items[:1]); len(got) != 0 {
		t.Fatalf("no restricted item: %v", got)
	}
}

func TestViewableProjectItems(t *testing.T) {
	trashed := time.Now()
	owner, member, stranger := int64(1), int64(2), int64(3)
	items := []Item{
		{ID: 10, ProjectID: 1, ViewAccess: ViewAccessOpen},
		{ID: 11, ProjectID: 2, ViewAccess: ViewAccessOpen},                                // another project
		{ID: 12, ProjectID: 1, ViewAccess: ViewAccessOpen, DeletedAt: &trashed},           // trashed
		{ID: 13, ProjectID: 1, ViewAccess: ViewAccessRestricted, CreatedByUserID: &owner}, // allowlist names member
		{ID: 14, ProjectID: 1, ViewAccess: ViewAccessRestricted, CreatedByUserID: &owner}, // no allowlist entry
		{ID: 15, ProjectID: 1, ViewAccess: ViewAccessOpen, ArchivedAt: &trashed},          // archived stays
	}
	entries := map[int64]ItemACL{13: {ViewUserIDs: []int64{member}}}
	ids := func(user *User) []int64 {
		var out []int64
		for _, it := range viewableProjectItems(items, entries, 1, user, false) {
			out = append(out, it.ID)
		}
		return out
	}
	equal := func(got, want []int64) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range want {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}
	if got := ids(&User{ID: member}); !equal(got, []int64{10, 13, 15}) {
		t.Fatalf("member sees %v", got)
	}
	if got := ids(&User{ID: stranger}); !equal(got, []int64{10, 15}) {
		t.Fatalf("stranger sees %v", got)
	}
	if got := ids(&User{ID: owner}); !equal(got, []int64{10, 13, 14, 15}) {
		t.Fatalf("owner sees %v", got)
	}
	// 許可の一覧が読めていなくても（空）、制限付きは持ち主以外に見せない。
	if got := viewableProjectItems(items, map[int64]ItemACL{}, 1, &User{ID: member}, false); len(got) != 2 {
		t.Fatalf("without entries a restricted item must stay hidden: %d", len(got))
	}
	if got := viewableProjectItems(nil, entries, 1, &User{ID: member}, false); got == nil || len(got) != 0 {
		t.Fatalf("no items: %#v", got)
	}
}

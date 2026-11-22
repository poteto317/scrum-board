package kanban

import "testing"

func TestCanModifyComment(t *testing.T) {
	admin := User{ID: 1, Role: RoleAdmin}
	owner := User{ID: 2, Role: RoleMember}
	other := User{ID: 3, Role: RoleMember}
	id := int64(2)
	withOwner := Comment{CreatedByUserID: &id}
	legacy := Comment{}

	if !canModifyComment(admin, withOwner) || !canModifyComment(admin, legacy) {
		t.Fatal("admin should modify any")
	}
	if !canModifyComment(owner, withOwner) {
		t.Fatal("owner should modify own")
	}
	if canModifyComment(other, withOwner) {
		t.Fatal("other member cannot modify")
	}
	if canModifyComment(owner, legacy) {
		t.Fatal("legacy comment is admin-only")
	}
}
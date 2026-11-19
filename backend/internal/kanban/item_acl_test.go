package kanban

import "testing"

func ptrID(id int64) *int64 { return &id }

func TestApplyViewerACLFlags(t *testing.T) {
	creatorID := int64(10)
	member := &User{ID: 2, Role: RoleMember}
	st := ItemACLState{
		ViewAccess:      ViewAccessRestricted,
		EditAccess:      EditAccessRestricted,
		CreatedByUserID: &creatorID,
		EditUserIDs:     []int64{2},
	}
	it := Item{}
	applyViewerACLFlags(&it, st, member)
	if !it.ViewerCanEdit || it.ViewerCanManage || it.ACL != nil {
		t.Fatalf("allowlisted editor: canEdit=%v canManage=%v acl=%v", it.ViewerCanEdit, it.ViewerCanManage, it.ACL)
	}
	admin := &User{ID: 1, Role: RoleAdmin}
	applyViewerACLFlags(&it, st, admin)
	if !it.ViewerCanEdit || !it.ViewerCanManage || it.ACL == nil {
		t.Fatalf("admin should manage with acl")
	}
}

func TestCanViewEditManageMatrix(t *testing.T) {
	creatorID := int64(10)
	stateOpen := ItemACLState{ViewAccess: ViewAccessOpen, EditAccess: EditAccessOpen, CreatedByUserID: &creatorID}
	statePublic := ItemACLState{ViewAccess: ViewAccessPublic, EditAccess: EditAccessOpen, CreatedByUserID: &creatorID}
	stateRest := ItemACLState{
		ViewAccess: ViewAccessRestricted, EditAccess: EditAccessRestricted, CreatedByUserID: &creatorID,
		ViewUserIDs: []int64{2}, EditUserIDs: []int64{3},
	}

	admin := &User{ID: 1, Role: RoleAdmin}
	member := &User{ID: 99, Role: RoleMember}
	viewer := &User{ID: 2, Role: RoleMember}
	editor := &User{ID: 3, Role: RoleMember}
	creator := &User{ID: creatorID, Role: RoleMember}
	disabledViewer := &User{ID: 2, Role: RoleMember, Disabled: true}

	cases := []struct {
		name           string
		state          ItemACLState
		user           *User
		wantView       bool
		wantEdit       bool
		wantManage     bool
	}{
		{"anon public", statePublic, nil, true, false, false},
		{"anon open", stateOpen, nil, false, false, false},
		{"anon restricted", stateRest, nil, false, false, false},
		{"member open", stateOpen, member, true, true, false},
		{"admin open", stateOpen, admin, true, true, true},
		{"creator open", stateOpen, creator, true, true, true},
		{"viewer restricted", stateRest, viewer, true, false, false},
		{"editor restricted", stateRest, editor, true, true, false},
		{"outsider restricted", stateRest, member, false, false, false},
		{"admin restricted", stateRest, admin, true, true, true},
		{"creator restricted", stateRest, creator, true, true, true},
		{"disabled allowlisted", stateRest, disabledViewer, false, false, false},
		{"edit-only implies view", ItemACLState{
			ViewAccess: ViewAccessRestricted, EditAccess: EditAccessRestricted, CreatedByUserID: &creatorID,
			EditUserIDs: []int64{3},
		}, editor, true, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CanView(tc.state, tc.user); got != tc.wantView {
				t.Fatalf("CanView=%v want %v", got, tc.wantView)
			}
			if got := CanEdit(tc.state, tc.user); got != tc.wantEdit {
				t.Fatalf("CanEdit=%v want %v", got, tc.wantEdit)
			}
			if got := CanManage(tc.state, tc.user); got != tc.wantManage {
				t.Fatalf("CanManage=%v want %v", got, tc.wantManage)
			}
		})
	}
}

func TestValidateEditAccessRejectsPublic(t *testing.T) {
	if err := ValidateEditAccess(ViewAccessPublic); err == nil {
		t.Fatal("expected error")
	}
}

func TestExistingNullCreatorManageAdminOnly(t *testing.T) {
	st := ItemACLState{ViewAccess: ViewAccessOpen, EditAccess: EditAccessOpen, CreatedByUserID: nil}
	member := &User{ID: 5, Role: RoleMember}
	admin := &User{ID: 1, Role: RoleAdmin}
	if CanManage(st, member) {
		t.Fatal("member must not manage without creator")
	}
	if !CanManage(st, admin) {
		t.Fatal("admin must manage")
	}
}

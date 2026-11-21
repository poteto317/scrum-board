package kanban

import "errors"

const (
	ViewAccessPublic     = "public"
	ViewAccessOpen       = "open"
	ViewAccessRestricted = "restricted"

	EditAccessOpen       = "open"
	EditAccessRestricted = "restricted"

	ACLCapabilityView = "view"
	ACLCapabilityEdit = "edit"
)

var (
	ErrInvalidACL = errors.New("invalid acl")
)

// ItemACL is the allowlist payload (manage responses only).
type ItemACL struct {
	ViewUserIDs []int64 `json:"viewUserIds"`
	EditUserIDs []int64 `json:"editUserIds"`
}

// ItemACLState is the data needed to evaluate view/edit/manage.
type ItemACLState struct {
	ViewAccess        string
	EditAccess        string
	CreatedByUserID   *int64
	ViewUserIDs       []int64
	EditUserIDs       []int64
}

func NormalizeViewAccess(v string) string {
	if v == "" {
		return ViewAccessOpen
	}
	return v
}

func NormalizeEditAccess(v string) string {
	if v == "" {
		return EditAccessOpen
	}
	return v
}

func ValidateViewAccess(v string) error {
	switch NormalizeViewAccess(v) {
	case ViewAccessPublic, ViewAccessOpen, ViewAccessRestricted:
		return nil
	default:
		return ErrInvalidACL
	}
}

func ValidateEditAccess(v string) error {
	switch NormalizeEditAccess(v) {
	case EditAccessOpen, EditAccessRestricted:
		return nil
	default:
		return ErrInvalidACL
	}
}

func itemIDsOf(items []Item) []int64 {
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	return ids
}

func containsUserID(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func isCreator(state ItemACLState, userID int64) bool {
	return state.CreatedByUserID != nil && *state.CreatedByUserID == userID
}

// CanManage: admin or creator. Anonymous never.
func CanManage(state ItemACLState, user *User) bool {
	if user == nil || user.Disabled {
		return false
	}
	if user.Role == RoleAdmin {
		return true
	}
	return isCreator(state, user.ID)
}

// CanView evaluates read access. edit capability implies view.
func CanView(state ItemACLState, user *User) bool {
	view := NormalizeViewAccess(state.ViewAccess)
	if err := ValidateViewAccess(view); err != nil {
		return false
	}
	switch view {
	case ViewAccessPublic:
		return true
	case ViewAccessOpen:
		return user != nil && !user.Disabled
	case ViewAccessRestricted:
		if user == nil || user.Disabled {
			return false
		}
		if user.Role == RoleAdmin || isCreator(state, user.ID) {
			return true
		}
		return containsUserID(state.ViewUserIDs, user.ID) || containsUserID(state.EditUserIDs, user.ID)
	default:
		return false
	}
}

// CanEdit requires login and edit policy. Also requires CanView.
func CanEdit(state ItemACLState, user *User) bool {
	if user == nil || user.Disabled {
		return false
	}
	edit := NormalizeEditAccess(state.EditAccess)
	if err := ValidateEditAccess(edit); err != nil {
		return false
	}
	if !CanView(state, user) {
		return false
	}
	switch edit {
	case EditAccessOpen:
		return true
	case EditAccessRestricted:
		if user.Role == RoleAdmin || isCreator(state, user.ID) {
			return true
		}
		return containsUserID(state.EditUserIDs, user.ID)
	default:
		return false
	}
}

func aclStateFromItem(it Item) ItemACLState {
	st := ItemACLState{
		ViewAccess:      it.ViewAccess,
		EditAccess:      it.EditAccess,
		CreatedByUserID: it.CreatedByUserID,
	}
	if it.ACL != nil {
		st.ViewUserIDs = it.ACL.ViewUserIDs
		st.EditUserIDs = it.ACL.EditUserIDs
	}
	return st
}

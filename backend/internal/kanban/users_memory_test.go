package kanban

import (
	"context"
	"strings"
	"time"
)

func (m *memoryRepo) CountUsers(context.Context) (int64, error) {
	return int64(len(m.users)), nil
}

func (m *memoryRepo) ListUsers(context.Context) ([]User, error) {
	out := make([]User, len(m.users))
	copy(out, m.users)
	return out, nil
}

func (m *memoryRepo) GetUser(_ context.Context, id int64) (User, error) {
	for _, u := range m.users {
		if u.ID == id {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (m *memoryRepo) GetUserByLoginName(_ context.Context, loginName string) (User, error) {
	for _, u := range m.users {
		if u.LoginName == loginName {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (m *memoryRepo) CreateUser(_ context.Context, in UserCreateInput) (User, error) {
	in.LoginName = strings.TrimSpace(in.LoginName)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	role := in.Role
	if role == "" {
		role = RoleMember
	}
	if err := validateUserCreate(in, role); err != nil {
		return User{}, err
	}
	for _, u := range m.users {
		if u.LoginName == in.LoginName {
			return User{}, ErrLoginNameTaken
		}
	}
	hash, err := HashPassword(in.Password)
	if err != nil {
		return User{}, err
	}
	now := time.Now().UTC()
	id := m.nextUserID
	m.nextUserID++
	u := User{
		ID: id, LoginName: in.LoginName, DisplayName: in.DisplayName,
		PasswordHash: hash, Role: role, Disabled: false,
		CreatedAt: now, UpdatedAt: now,
	}
	m.users = append(m.users, u)
	return u, nil
}

func (m *memoryRepo) UpdateUser(ctx context.Context, id int64, patch UserPatch, actorID int64) (User, error) {
	idx := -1
	var cur User
	for i, u := range m.users {
		if u.ID == id {
			idx, cur = i, u
			break
		}
	}
	if idx < 0 {
		return User{}, ErrNotFound
	}
	next := cur
	if patch.DisplayName != nil {
		name := strings.TrimSpace(*patch.DisplayName)
		if name == "" || len([]rune(name)) > 80 {
			return User{}, ErrInvalidUserInput
		}
		next.DisplayName = name
	}
	if patch.Role != nil {
		if *patch.Role != RoleAdmin && *patch.Role != RoleMember {
			return User{}, ErrInvalidUserInput
		}
		next.Role = *patch.Role
	}
	if patch.Disabled != nil {
		next.Disabled = *patch.Disabled
	}
	if patch.Password != nil {
		if *patch.Password == "" {
			return User{}, ErrInvalidUserInput
		}
		if err := validatePasswordLength(*patch.Password); err != nil {
			return User{}, err
		}
		hash, err := HashPassword(*patch.Password)
		if err != nil {
			return User{}, err
		}
		next.PasswordHash = hash
	}
	if err := validateUserMutation(ctx, m, cur, next, actorID); err != nil {
		return User{}, err
	}
	next.UpdatedAt = time.Now().UTC()
	m.users[idx] = next
	if (next.Disabled && !cur.Disabled) || (patch.Password != nil && *patch.Password != "") {
		_ = m.DeleteSessionsForUser(ctx, id)
	}
	return next, nil
}

func (m *memoryRepo) CountEnabledAdmins(context.Context) (int64, error) {
	var n int64
	for _, u := range m.users {
		if u.Role == RoleAdmin && !u.Disabled {
			n++
		}
	}
	return n, nil
}

func (m *memoryRepo) CreateSession(_ context.Context, userID int64, now time.Time) (Session, error) {
	if m.sessions == nil {
		m.sessions = map[string]Session{}
	}
	id, err := newSessionID()
	if err != nil {
		return Session{}, err
	}
	s := Session{ID: id, UserID: userID, ExpiresAt: now.Add(SessionTTL), CreatedAt: now}
	m.sessions[id] = s
	return s, nil
}

func (m *memoryRepo) DeleteSession(_ context.Context, id string) error {
	delete(m.sessions, id)
	return nil
}

func (m *memoryRepo) DeleteSessionsForUser(_ context.Context, userID int64) error {
	for id, s := range m.sessions {
		if s.UserID == userID {
			delete(m.sessions, id)
		}
	}
	return nil
}

func (m *memoryRepo) UserBySessionID(_ context.Context, sessionID string, now time.Time) (User, error) {
	s, ok := m.sessions[sessionID]
	if !ok || !s.ExpiresAt.After(now) {
		return User{}, ErrUnauthorized
	}
	for _, u := range m.users {
		if u.ID == s.UserID {
			if u.Disabled {
				return User{}, ErrUnauthorized
			}
			return u, nil
		}
	}
	return User{}, ErrUnauthorized
}

func (m *memoryRepo) ListACLEntriesForItems(_ context.Context, itemIDs []int64) (map[int64]ItemACL, error) {
	m.aclListCalls.Add(1)
	if m.aclListFail != nil {
		return nil, m.aclListFail
	}
	out := make(map[int64]ItemACL, len(itemIDs))
	if m.aclEntries == nil {
		return out, nil
	}
	for _, id := range itemIDs {
		if acl, ok := m.aclEntries[id]; ok {
			cp := ItemACL{
				ViewUserIDs: append([]int64(nil), acl.ViewUserIDs...),
				EditUserIDs: append([]int64(nil), acl.EditUserIDs...),
			}
			out[id] = cp
		}
	}
	return out, nil
}

func (m *memoryRepo) ReplaceItemACL(_ context.Context, id int64, viewAccess, editAccess string, viewIDs, editIDs []int64) (Item, error) {
	if err := ValidateViewAccess(viewAccess); err != nil {
		return Item{}, ErrInvalidACL
	}
	if err := ValidateEditAccess(editAccess); err != nil {
		return Item{}, ErrInvalidACL
	}
	c, ok := m.cards[id]
	if !ok || !m.living(c) {
		return Item{}, ErrNotFound
	}
	viewIDs = dedupeIDs(viewIDs)
	editIDs = dedupeIDs(editIDs)
	viewSet := map[int64]struct{}{}
	for _, uid := range viewIDs {
		viewSet[uid] = struct{}{}
	}
	for _, uid := range editIDs {
		if _, ok := viewSet[uid]; !ok {
			viewIDs = append(viewIDs, uid)
		}
	}
	c.ViewAccess = viewAccess
	c.EditAccess = editAccess
	m.cards[id] = c
	if m.aclEntries == nil {
		m.aclEntries = map[int64]ItemACL{}
	}
	m.aclEntries[id] = ItemACL{ViewUserIDs: viewIDs, EditUserIDs: editIDs}
	c.ACL = &ItemACL{ViewUserIDs: append([]int64(nil), viewIDs...), EditUserIDs: append([]int64(nil), editIDs...)}
	return c, nil
}

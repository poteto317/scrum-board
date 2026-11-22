package kanban

import (
	"testing"
	"time"
)

const secretPeerTitle = "secret-peer-title-xyz"

func relatedACLFixture(t *testing.T) (m *memoryRepo, open, secret, allowed Item, sess Session) {
	t.Helper()
	m = fresh()
	hash, _ := HashPassword("x")
	m.users = append(m.users, User{ID: 2, LoginName: "mem", DisplayName: "mem", PasswordHash: hash, Role: RoleMember})
	open, _ = m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "open", Description: "d"})
	secret, _ = m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: secretPeerTitle, Description: "d"})
	allowed, _ = m.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "allowed-peer", Description: "d"})
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	m.cards[secret.ID] = secret
	m.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}, EditUserIDs: []int64{1}}
	sess = Session{ID: "mem-related-acl", UserID: 2, ExpiresAt: time.Now().UTC().Add(time.Hour)}
	m.sessions[sess.ID] = sess
	return m, open, secret, allowed, sess
}

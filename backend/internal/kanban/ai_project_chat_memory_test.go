package kanban

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"
)

// memoryProjectAIMessage keeps the owner next to the stored message (the API shape has no user id).
type memoryProjectAIMessage struct {
	ProjectAIMessage
	userID int64
}

func (m *memoryRepo) ListProjectAIMessages(_ context.Context, projectID, userID int64) ([]ProjectAIMessage, error) {
	out := make([]ProjectAIMessage, 0)
	for _, msg := range m.projectAIMessages {
		if msg.ProjectID == projectID && msg.userID == userID {
			out = append(out, msg.ProjectAIMessage)
		}
	}
	// Ids grow in insertion order; the clock may give two appends the same instant.
	slices.SortFunc(out, func(a, b ProjectAIMessage) int { return cmp.Compare(a.ID, b.ID) })
	return out, nil
}

func (m *memoryRepo) AppendProjectAITurn(ctx context.Context, projectID, userID int64, userBody, assistantBody string, inTok, outTok int64) error {
	if !m.projectExists(projectID) {
		return ErrProject
	}
	if m.projectAIMessages == nil {
		m.projectAIMessages = map[int64]memoryProjectAIMessage{}
	}
	existing, _ := m.ListProjectAIMessages(ctx, projectID, userID)
	for i := 0; i < len(existing)+2-maxAIChatStoredMessages; i++ {
		delete(m.projectAIMessages, existing[i].ID)
	}
	now := time.Now().UTC()
	uid := m.nextAIMessageID
	aid := uid + 1
	m.nextAIMessageID += 2
	m.projectAIMessages[uid] = memoryProjectAIMessage{userID: userID, ProjectAIMessage: ProjectAIMessage{
		ID: uid, ProjectID: projectID, Role: AIRoleUser, Body: userBody, CreatedAt: now,
	}}
	m.projectAIMessages[aid] = memoryProjectAIMessage{userID: userID, ProjectAIMessage: ProjectAIMessage{
		ID: aid, ProjectID: projectID, Role: AIRoleAssistant, Body: assistantBody, CreatedAt: now.Add(time.Nanosecond),
		InputTokens: tokenCountPtr(inTok), OutputTokens: tokenCountPtr(outTok),
	}}
	return nil
}

func (m *memoryRepo) ClearProjectAIMessages(_ context.Context, projectID, userID int64) error {
	for id, msg := range m.projectAIMessages {
		if msg.ProjectID == projectID && msg.userID == userID {
			delete(m.projectAIMessages, id)
		}
	}
	return nil
}

func (m *memoryRepo) dropProjectAIMessages(projectID int64) {
	for id, msg := range m.projectAIMessages {
		if msg.ProjectID == projectID {
			delete(m.projectAIMessages, id)
		}
	}
}

// searchViewerCanView mirrors itemSearchViewSQL: CanView for the logged-in, enabled viewer,
// with the allowlists as they are stored.
func (m *memoryRepo) searchViewerCanView(card Item, v ItemSearchViewer) bool {
	state := aclStateFromItem(card)
	if acl, ok := m.aclEntries[card.ID]; ok {
		state.ViewUserIDs, state.EditUserIDs = acl.ViewUserIDs, acl.EditUserIDs
	}
	viewer := User{ID: v.UserID, Role: RoleMember}
	if v.Admin {
		viewer.Role = RoleAdmin
	}
	return CanView(state, &viewer)
}

// SearchProjectItems mirrors projectItemSearchSQL: same filters (the view check included), same order, at most 201 rows.
func (m *memoryRepo) SearchProjectItems(_ context.Context, projectID int64, s ItemSearch) ([]Item, error) {
	out := make([]Item, 0)
	for _, card := range m.cards {
		if !m.living(card) || m.cardProjectID(card) != projectID {
			continue
		}
		if !m.searchViewerCanView(card, s.Viewer) {
			continue
		}
		if s.ColumnID != nil && card.ColumnID != *s.ColumnID {
			continue
		}
		if s.Assignee != "" && !strings.EqualFold(card.Assignee, s.Assignee) {
			continue
		}
		if s.DueFrom != nil && (card.DueAt == nil || card.DueAt.Before(*s.DueFrom)) {
			continue
		}
		if s.DueTo != nil && (card.DueAt == nil || !card.DueAt.Before(*s.DueTo)) {
			continue
		}
		if !m.matchesAllTerms(card, s.Terms) {
			continue
		}
		out = append(out, card)
	}
	slices.SortFunc(out, func(a, b Item) int {
		if s.SortByDue {
			switch {
			case a.DueAt == nil && b.DueAt != nil:
				return 1
			case a.DueAt != nil && b.DueAt == nil:
				return -1
			case a.DueAt != nil && b.DueAt != nil:
				if c := a.DueAt.Compare(*b.DueAt); c != 0 {
					return c
				}
			}
			return cmp.Compare(a.ID, b.ID)
		}
		if c := b.UpdatedAt.Compare(a.UpdatedAt); c != 0 {
			return c
		}
		return cmp.Compare(b.ID, a.ID)
	})
	if len(out) > maxItemSearchMatches+1 {
		out = out[:maxItemSearchMatches+1]
	}
	return out, nil
}

func (m *memoryRepo) matchesAllTerms(card Item, terms []string) bool {
	for _, term := range terms {
		hit := containsFold(card.Title, term) || containsFold(card.Description, term) || containsFold(card.Solution, term)
		if n, ok := searchTermNumber(term); ok && card.Number == n {
			hit = true
		}
		for _, c := range m.comments {
			if hit {
				break
			}
			hit = c.ItemID == card.ID && containsFold(c.Body, term)
		}
		if !hit {
			return false
		}
	}
	return true
}

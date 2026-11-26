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

// memoryProjectAIConversation keeps the owner next to the conversation, like the message.
type memoryProjectAIConversation struct {
	ProjectAIConversation
	userID int64
}

// projectAINow is a clock that never gives the same instant twice, so the order by updated_at
// is the order of the calls (MySQL's clock has microseconds, and its calls take longer than one).
func (m *memoryRepo) projectAINow() time.Time {
	now := time.Now().UTC().Truncate(time.Microsecond)
	if !now.After(m.projectAIClock) {
		now = m.projectAIClock.Add(time.Microsecond)
	}
	m.projectAIClock = now
	return now
}

func (m *memoryRepo) ListProjectAIConversations(_ context.Context, projectID, userID int64) ([]ProjectAIConversation, error) {
	out := make([]ProjectAIConversation, 0)
	for _, c := range m.projectAIConversations {
		if c.ProjectID == projectID && c.userID == userID {
			out = append(out, c.ProjectAIConversation)
		}
	}
	slices.SortFunc(out, func(a, b ProjectAIConversation) int {
		if c := b.UpdatedAt.Compare(a.UpdatedAt); c != 0 {
			return c
		}
		return cmp.Compare(b.ID, a.ID)
	})
	if len(out) > maxProjectAIConversations {
		out = out[:maxProjectAIConversations]
	}
	return out, nil
}

func (m *memoryRepo) GetProjectAIConversation(_ context.Context, projectID, userID, conversationID int64) (ProjectAIConversation, error) {
	c, ok := m.projectAIConversations[conversationID]
	if !ok || c.ProjectID != projectID || c.userID != userID {
		return ProjectAIConversation{}, ErrNotFound
	}
	return c.ProjectAIConversation, nil
}

func (m *memoryRepo) LatestProjectAIConversation(ctx context.Context, projectID, userID int64) (*ProjectAIConversation, error) {
	list, _ := m.ListProjectAIConversations(ctx, projectID, userID)
	if len(list) == 0 {
		return nil, nil
	}
	return &list[0], nil
}

func (m *memoryRepo) ListProjectAIMessages(_ context.Context, projectID, userID, conversationID int64) ([]ProjectAIMessage, error) {
	out := make([]ProjectAIMessage, 0)
	for _, msg := range m.projectAIMessages {
		if msg.ConversationID == conversationID && msg.ProjectID == projectID && msg.userID == userID {
			out = append(out, msg.ProjectAIMessage)
		}
	}
	// Ids grow in insertion order; the clock may give two appends the same instant.
	slices.SortFunc(out, func(a, b ProjectAIMessage) int { return cmp.Compare(a.ID, b.ID) })
	byMessage := map[int64][]ProjectAIProposal{}
	for _, p := range m.projectAIProposals {
		if p.projectID == projectID && p.userID == userID {
			byMessage[p.MessageID] = append(byMessage[p.MessageID], p.ProjectAIProposal)
		}
	}
	for id := range byMessage {
		slices.SortFunc(byMessage[id], func(a, b ProjectAIProposal) int { return cmp.Compare(a.ID, b.ID) })
	}
	attachProposalsToMessages(out, byMessage)
	return out, nil
}

// AppendProjectAITurn mirrors the MySQL steps: find or create the conversation (and keep the
// 100 newest), trim its messages to 200 with the two new ones, add them, touch updated_at.
func (m *memoryRepo) AppendProjectAITurn(ctx context.Context, projectID, userID int64, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error) {
	if !m.projectExists(projectID) {
		return ProjectAIConversation{}, ErrProject
	}
	if m.projectAIMessages == nil {
		m.projectAIMessages = map[int64]memoryProjectAIMessage{}
	}
	if m.projectAIConversations == nil {
		m.projectAIConversations = map[int64]memoryProjectAIConversation{}
	}
	var conversation memoryProjectAIConversation
	found := false
	if conversationID != nil {
		conversation, found = m.projectAIConversations[*conversationID]
		found = found && conversation.ProjectID == projectID && conversation.userID == userID
	}
	if !found {
		m.nextProjectAIConversationID++
		now := m.projectAINow()
		conversation = memoryProjectAIConversation{userID: userID, ProjectAIConversation: ProjectAIConversation{
			ID: m.nextProjectAIConversationID, ProjectID: projectID, Title: turn.Title, CreatedAt: now, UpdatedAt: now,
		}}
		m.projectAIConversations[conversation.ID] = conversation
		m.trimProjectAIConversations(projectID, userID, conversation.ID)
	}
	existing, _ := m.ListProjectAIMessages(ctx, projectID, userID, conversation.ID)
	for i := range projectAIMessagesOverLimit(len(existing), projectAITurnMessages) {
		delete(m.projectAIMessages, existing[i].ID)
		m.dropProjectAIProposalsOf(existing[i].ID)
	}
	now := m.projectAINow()
	uid := m.nextAIMessageID
	aid := uid + 1
	m.nextAIMessageID += 2
	m.projectAIMessages[uid] = memoryProjectAIMessage{userID: userID, ProjectAIMessage: ProjectAIMessage{
		ID: uid, ProjectID: projectID, ConversationID: conversation.ID, Role: AIRoleUser, Body: turn.UserBody, CreatedAt: now,
	}}
	m.projectAIMessages[aid] = memoryProjectAIMessage{userID: userID, ProjectAIMessage: ProjectAIMessage{
		ID: aid, ProjectID: projectID, ConversationID: conversation.ID, Role: AIRoleAssistant, Body: turn.AssistantBody, CreatedAt: now.Add(time.Nanosecond),
		InputTokens: tokenCountPtr(turn.InputTokens), OutputTokens: tokenCountPtr(turn.OutputTokens),
	}}
	m.storeProjectAIProposals(projectID, userID, aid, now, turn.Proposals)
	conversation.UpdatedAt = m.projectAINow()
	m.projectAIConversations[conversation.ID] = conversation
	return conversation.ProjectAIConversation, nil
}

// trimProjectAIConversations deletes what is beyond the 100 conversations of the scope,
// oldest update first, never the one named keep.
func (m *memoryRepo) trimProjectAIConversations(projectID, userID, keep int64) {
	var all []ProjectAIConversation
	for _, c := range m.projectAIConversations {
		if c.ProjectID == projectID && c.userID == userID {
			all = append(all, c.ProjectAIConversation)
		}
	}
	slices.SortFunc(all, func(a, b ProjectAIConversation) int {
		if c := a.UpdatedAt.Compare(b.UpdatedAt); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	overflow := projectAIConversationsOverLimit(len(all))
	for _, c := range all {
		if overflow <= 0 {
			break
		}
		if c.ID == keep {
			continue
		}
		m.dropProjectAIConversation(c.ID)
		overflow--
	}
}

// dropProjectAIConversation deletes a conversation and its messages (ON DELETE CASCADE).
func (m *memoryRepo) dropProjectAIConversation(conversationID int64) {
	delete(m.projectAIConversations, conversationID)
	for id, msg := range m.projectAIMessages {
		if msg.ConversationID == conversationID {
			delete(m.projectAIMessages, id)
			m.dropProjectAIProposalsOf(id)
		}
	}
}

func (m *memoryRepo) DeleteProjectAIConversation(ctx context.Context, projectID, userID, conversationID int64) error {
	if _, err := m.GetProjectAIConversation(ctx, projectID, userID, conversationID); err != nil {
		return err
	}
	m.dropProjectAIConversation(conversationID)
	return nil
}

func (m *memoryRepo) ClearProjectAIConversations(_ context.Context, projectID, userID int64) error {
	for id, c := range m.projectAIConversations {
		if c.ProjectID == projectID && c.userID == userID {
			delete(m.projectAIConversations, id)
		}
	}
	for id, msg := range m.projectAIMessages {
		if msg.ProjectID == projectID && msg.userID == userID {
			delete(m.projectAIMessages, id)
			m.dropProjectAIProposalsOf(id)
		}
	}
	return nil
}

func (m *memoryRepo) dropProjectAIMessages(projectID int64) {
	for id, c := range m.projectAIConversations {
		if c.ProjectID == projectID {
			delete(m.projectAIConversations, id)
		}
	}
	for id, msg := range m.projectAIMessages {
		if msg.ProjectID == projectID {
			delete(m.projectAIMessages, id)
			m.dropProjectAIProposalsOf(id)
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

// memoryProjectAIProposal keeps the owner next to the proposal, like the message.
type memoryProjectAIProposal struct {
	ProjectAIProposal
	projectID, userID int64
}

// storeProjectAIProposals mirrors insertProjectAIProposals.
func (m *memoryRepo) storeProjectAIProposals(projectID, userID, messageID int64, now time.Time, drafts []ProjectAIProposalDraft) {
	if m.projectAIProposals == nil {
		m.projectAIProposals = map[int64]memoryProjectAIProposal{}
	}
	for _, d := range drafts {
		m.nextProjectAIProposalID++
		m.projectAIProposals[m.nextProjectAIProposalID] = memoryProjectAIProposal{projectID: projectID, userID: userID, ProjectAIProposal: ProjectAIProposal{
			ID: m.nextProjectAIProposalID, MessageID: messageID, Kind: d.Kind, State: ProposalStatePending,
			ItemNumber: d.ItemNumber, ItemTitle: d.ItemTitle, ColumnID: d.ColumnID, ColumnName: d.ColumnName,
			Title: d.Title, Description: d.Description, BaseDescription: d.BaseDescription, CreatedAt: now, UpdatedAt: now,
		}}
	}
}

// dropProjectAIProposalsOf deletes the proposals of a deleted message (ON DELETE CASCADE).
func (m *memoryRepo) dropProjectAIProposalsOf(messageID int64) {
	for id, p := range m.projectAIProposals {
		if p.MessageID == messageID {
			delete(m.projectAIProposals, id)
		}
	}
}

func (m *memoryRepo) UpdateProjectAIProposal(_ context.Context, projectID, userID, proposalID int64, change ProjectAIProposalChange) (ProjectAIProposal, error) {
	p, ok := m.projectAIProposals[proposalID]
	if !ok || p.projectID != projectID || p.userID != userID {
		return ProjectAIProposal{}, ErrNotFound
	}
	if !proposalTransitionAllowed(p.ProjectAIProposal, change) {
		return p.ProjectAIProposal, ErrProposalConflict
	}
	p.ProjectAIProposal = applyProposalChange(p.ProjectAIProposal, change)
	p.UpdatedAt = m.projectAINow()
	m.projectAIProposals[proposalID] = p
	return p.ProjectAIProposal, nil
}

// applyProposalChange is the proposal after an allowed change, as UpdateProjectAIProposal
// writes it (the state, and COALESCE for the number) (state and, when given, the number).
func applyProposalChange(p ProjectAIProposal, change ProjectAIProposalChange) ProjectAIProposal {
	p.State = change.State
	if change.CreatedItemNumber != nil {
		n := *change.CreatedItemNumber
		p.CreatedItemNumber = &n
	}
	return p
}

package kanban

import "sync"

// userInFlight remembers which users have a project chat running in this process, so one
// user cannot hold several of the shared AI slots for tens of seconds at once.
type userInFlight struct {
	mu     sync.Mutex
	active map[int64]struct{}
}

func newUserInFlight() *userInFlight {
	return &userInFlight{active: make(map[int64]struct{})}
}

// begin marks the user as running. It is false when the user already has one running;
// the caller must then not call end.
func (s *userInFlight) begin(userID int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, running := s.active[userID]; running {
		return false
	}
	s.active[userID] = struct{}{}
	return true
}

func (s *userInFlight) end(userID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.active, userID)
}

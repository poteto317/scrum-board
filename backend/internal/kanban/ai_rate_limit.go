package kanban

import (
	"net/http"
	"sync"
	"time"
)

const aiRateWindow = time.Minute

const msgAIRateLimit = "AIの利用頻度が高すぎます。少し待って再試行してください。"

// AIRateLimiter limits how often a user may start an AI call (after credit check, before the semaphore).
// Try reserves under one lock (no Allow/Record TOCTOU). Release undoes a reservation when acquireSlot fails.
type AIRateLimiter interface {
	Enabled() bool
	Try(userID int64, now time.Time) bool
	Release(userID int64, at time.Time)
}

type noopAIRateLimiter struct{}

func (noopAIRateLimiter) Enabled() bool               { return false }
func (noopAIRateLimiter) Try(int64, time.Time) bool   { return true }
func (noopAIRateLimiter) Release(int64, time.Time)    {}

// NewNoopAIRateLimiter returns a limiter that never rejects.
func NewNoopAIRateLimiter() AIRateLimiter { return noopAIRateLimiter{} }

type slidingAIRateLimiter struct {
	n    int
	mu   sync.Mutex
	hits map[int64][]time.Time
}

// NewSlidingAIRateLimiter allows at most n reserved/permitted calls per user in any 60s window.
// n <= 0 yields a no-op limiter.
func NewSlidingAIRateLimiter(n int) AIRateLimiter {
	if n <= 0 {
		return NewNoopAIRateLimiter()
	}
	return &slidingAIRateLimiter{n: n, hits: make(map[int64][]time.Time)}
}

func (l *slidingAIRateLimiter) Enabled() bool { return true }

func (l *slidingAIRateLimiter) Try(userID int64, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	kept := l.pruneLocked(userID, now)
	if len(kept) >= l.n {
		return false
	}
	l.hits[userID] = append(kept, now)
	return true
}

func (l *slidingAIRateLimiter) Release(userID int64, at time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	hits := l.hits[userID]
	for i := len(hits) - 1; i >= 0; i-- {
		if hits[i].Equal(at) {
			next := make([]time.Time, 0, len(hits)-1)
			next = append(next, hits[:i]...)
			next = append(next, hits[i+1:]...)
			if len(next) == 0 {
				delete(l.hits, userID)
			} else {
				l.hits[userID] = next
			}
			return
		}
	}
}

func (l *slidingAIRateLimiter) pruneLocked(userID int64, now time.Time) []time.Time {
	cut := now.Add(-aiRateWindow)
	old := l.hits[userID]
	kept := old[:0]
	for _, t := range old {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.hits, userID)
		return nil
	}
	l.hits[userID] = kept
	return kept
}

// reserveAIRateLimit tries to reserve one rate-limit slot. limited=true means write 429 ai_rate_limit.
// If reserved, call releaseAIRateLimit when the request does not proceed to the model
// (acquireSlot busy, or refined column lookup failure before the AI call).
func (h handler) reserveAIRateLimit(r *http.Request) (userID int64, at time.Time, reserved bool, limited bool) {
	if h.rateLimiter == nil || !h.rateLimiter.Enabled() {
		return 0, time.Time{}, false, false
	}
	u, ok := CurrentUser(r.Context())
	if !ok {
		return 0, time.Time{}, false, false
	}
	at = time.Now()
	if !h.rateLimiter.Try(u.ID, at) {
		return u.ID, at, false, true
	}
	return u.ID, at, true, false
}

func (h handler) releaseAIRateLimit(userID int64, at time.Time, reserved bool) {
	if !reserved || h.rateLimiter == nil || !h.rateLimiter.Enabled() {
		return
	}
	h.rateLimiter.Release(userID, at)
}

func writeAIRateLimited(w http.ResponseWriter, writeErr func(http.ResponseWriter, int, string, string)) {
	writeErr(w, http.StatusTooManyRequests, "ai_rate_limit", msgAIRateLimit)
}

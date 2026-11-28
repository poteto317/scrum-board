package kanban

import (
	"sync"
	"time"
)

const (
	loginFailureLimit = 5
	loginLockDuration = 15 * time.Minute
	loginFailureTTL   = 15 * time.Minute
)

// LoginAttemptLimiter tracks consecutive failed password attempts per client IP and per
// login-name + client-IP pair (form login and Basic auth use separate instances).
// Keying the login name with the IP means a third party cannot lock someone else's
// login from another address (#171).
type LoginAttemptLimiter interface {
	Allow(loginKey, ip string, now time.Time) bool
	RecordFailure(loginKey, ip string, now time.Time)
	// RecordSuccess clears the login+IP pair counter only (IP counters stay for NAT shared exits).
	RecordSuccess(loginKey, ip string)
}

type loginAttemptEntry struct {
	failures    int
	lockedUntil time.Time
	lastFailure time.Time
}

type memoryLoginAttemptLimiter struct {
	mu    sync.Mutex
	byKey map[string]*loginAttemptEntry
}

// NewMemoryLoginAttemptLimiter returns a process-local limiter (5 failures → 15m lock).
func NewMemoryLoginAttemptLimiter() LoginAttemptLimiter {
	return &memoryLoginAttemptLimiter{byKey: make(map[string]*loginAttemptEntry)}
}

func loginAttemptKey(loginKey, ip string) string { return "login:" + loginKey + "|" + ip }
func ipAttemptKey(ip string) string              { return "ip:" + ip }

func (l *memoryLoginAttemptLimiter) Allow(loginKey, ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(now)
	return !l.isLocked(loginAttemptKey(loginKey, ip), now) && !l.isLocked(ipAttemptKey(ip), now)
}

func (l *memoryLoginAttemptLimiter) RecordFailure(loginKey, ip string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(now)
	l.bump(loginAttemptKey(loginKey, ip), now)
	l.bump(ipAttemptKey(ip), now)
}

func (l *memoryLoginAttemptLimiter) RecordSuccess(loginKey, ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.byKey, loginAttemptKey(loginKey, ip))
}

func (l *memoryLoginAttemptLimiter) isLocked(key string, now time.Time) bool {
	e := l.byKey[key]
	return e != nil && e.lockedUntil.After(now)
}

func (l *memoryLoginAttemptLimiter) bump(key string, now time.Time) {
	e := l.byKey[key]
	if e == nil {
		e = &loginAttemptEntry{}
		l.byKey[key] = e
	}
	if e.lockedUntil.After(now) {
		return
	}
	e.failures++
	e.lastFailure = now
	if e.failures >= loginFailureLimit {
		e.lockedUntil = now.Add(loginLockDuration)
		e.failures = 0
	}
}

func (l *memoryLoginAttemptLimiter) pruneLocked(now time.Time) {
	for k, e := range l.byKey {
		if e.lockedUntil.After(now) {
			continue
		}
		if e.failures == 0 {
			delete(l.byKey, k)
			continue
		}
		if !e.lastFailure.IsZero() && now.Sub(e.lastFailure) >= loginFailureTTL {
			delete(l.byKey, k)
		}
	}
}

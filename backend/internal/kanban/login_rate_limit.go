package kanban

import (
	"sync"
	"time"
)

const (
	loginFailureLimit = 5
	loginLockDuration = 15 * time.Minute
)

// LoginAttemptLimiter tracks consecutive failed logins per login key and client IP.
type LoginAttemptLimiter interface {
	Allow(loginKey, ip string, now time.Time) bool
	RecordFailure(loginKey, ip string, now time.Time)
	RecordSuccess(loginKey, ip string)
}

type loginAttemptEntry struct {
	failures    int
	lockedUntil time.Time
}

type memoryLoginAttemptLimiter struct {
	mu   sync.Mutex
	byKey map[string]*loginAttemptEntry
}

// NewMemoryLoginAttemptLimiter returns a process-local limiter (5 failures → 15m lock).
func NewMemoryLoginAttemptLimiter() LoginAttemptLimiter {
	return &memoryLoginAttemptLimiter{byKey: make(map[string]*loginAttemptEntry)}
}

func loginAttemptKey(loginKey string) string { return "login:" + loginKey }
func ipAttemptKey(ip string) string           { return "ip:" + ip }

func (l *memoryLoginAttemptLimiter) Allow(loginKey, ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(now)
	return !l.isLocked(loginAttemptKey(loginKey), now) && !l.isLocked(ipAttemptKey(ip), now)
}

func (l *memoryLoginAttemptLimiter) RecordFailure(loginKey, ip string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.bump(loginAttemptKey(loginKey), now)
	l.bump(ipAttemptKey(ip), now)
}

func (l *memoryLoginAttemptLimiter) RecordSuccess(loginKey, ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.byKey, loginAttemptKey(loginKey))
	delete(l.byKey, ipAttemptKey(ip))
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
	if e.failures >= loginFailureLimit {
		e.lockedUntil = now.Add(loginLockDuration)
		e.failures = 0
	}
}

func (l *memoryLoginAttemptLimiter) pruneLocked(now time.Time) {
	for k, e := range l.byKey {
		if e.failures == 0 && !e.lockedUntil.After(now) {
			delete(l.byKey, k)
		}
	}
}

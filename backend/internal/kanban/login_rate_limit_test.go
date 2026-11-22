package kanban

import (
	"testing"
	"time"
)

func TestLoginAttemptLimiterThresholdAndRelock(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	login, ip := "admin", "1.2.3.4"

	for i := 0; i < loginFailureLimit-1; i++ {
		if !l.Allow(login, ip, now) {
			t.Fatalf("attempt %d should allow", i+1)
		}
		l.RecordFailure(login, ip, now)
	}
	if !l.Allow(login, ip, now) {
		t.Fatal("4th failure path should still allow before 5th record")
	}
	l.RecordFailure(login, ip, now)
	if l.Allow(login, ip, now) {
		t.Fatal("after 5 failures should lock")
	}

	unlocked := now.Add(loginLockDuration + time.Second)
	if !l.Allow(login, ip, unlocked) {
		t.Fatal("should unlock after 15m")
	}
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure(login, ip, unlocked)
	}
	if l.Allow(login, ip, unlocked) {
		t.Fatal("should relock after another 5 failures")
	}
}

func TestLoginAttemptLimiterSuccessClearsLoginNotIP(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < 3; i++ {
		l.RecordFailure("a", "9.9.9.9", now)
	}
	l.RecordSuccess("a", "9.9.9.9")
	// login key cleared: can fail again without immediate lock from prior login counts
	for i := 0; i < 2; i++ {
		l.RecordFailure("a", "10.0.0.1", now)
	}
	if !l.Allow("a", "10.0.0.1", now) {
		t.Fatal("login key should have been cleared by success")
	}
	// IP key retained: 3 prior failures on 9.9.9.9 still count toward lock
	l.RecordFailure("b", "9.9.9.9", now)
	l.RecordFailure("b", "9.9.9.9", now)
	if l.Allow("c", "9.9.9.9", now) {
		t.Fatal("IP failures should not clear on another user's success")
	}
}

func TestLoginAttemptLimiterIndependentKeys(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("alice", "10.0.0.1", now)
	}
	if l.Allow("alice", "10.0.0.2", now) {
		t.Fatal("login key lock should block other IPs for same login")
	}
	if !l.Allow("bob", "10.0.0.2", now) {
		t.Fatal("different login+ip should still allow")
	}
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("carol", "10.0.0.1", now)
	}
	if l.Allow("dave", "10.0.0.1", now) {
		t.Fatal("ip lock should block other logins from same IP")
	}
}

func TestLoginAttemptLimiterPrunesStaleFailures(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 4; i++ {
		l.RecordFailure("ghost", "8.8.8.8", now)
	}
	later := now.Add(loginFailureTTL + time.Second)
	// After TTL prune, prior failures must not count toward a new lock.
	l.RecordFailure("ghost", "8.8.8.8", later)
	if !l.Allow("ghost", "8.8.8.8", later) {
		t.Fatal("stale failures should have been pruned before the new failure")
	}
}

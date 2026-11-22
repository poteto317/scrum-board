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

func TestLoginAttemptLimiterSuccessClears(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < 3; i++ {
		l.RecordFailure("a", "9.9.9.9", now)
	}
	l.RecordSuccess("a", "9.9.9.9")
	for i := 0; i < loginFailureLimit; i++ {
		if !l.Allow("a", "9.9.9.9", now) {
			t.Fatalf("after success, attempt %d should allow", i+1)
		}
		if i < loginFailureLimit-1 {
			l.RecordFailure("a", "9.9.9.9", now)
		}
	}
}

func TestLoginAttemptLimiterIndependentKeys(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("alice", "10.0.0.1", now)
	}
	if l.Allow("alice", "10.0.0.2", now) {
		// login key still locked even with other IP
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

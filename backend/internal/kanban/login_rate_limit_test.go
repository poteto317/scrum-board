package kanban

import (
	"strconv"
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

func TestLoginAttemptLimiterSuccessClearsPairNotIP(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter().(*memoryLoginAttemptLimiter)
	now := time.Now().UTC()
	const ip = "9.9.9.9"
	for i := 0; i < loginFailureLimit-1; i++ {
		l.RecordFailure("a", ip, now)
	}
	l.RecordSuccess("a", ip)
	if _, ok := l.byKey[loginAttemptKey("a", ip)]; ok {
		t.Fatal("success must clear the login+ip pair key")
	}
	e := l.byKey[ipAttemptKey(ip)]
	if e == nil || e.failures != loginFailureLimit-1 {
		t.Fatalf("IP failures must survive success (L-1028): %+v", e)
	}
	l.RecordFailure("b", ip, now)
	if l.Allow("c", ip, now) {
		t.Fatal("IP should lock on the 5th failure counted across logins")
	}
}

func TestLoginAttemptLimiterIndependentKeys(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("alice", "10.0.0.1", now)
	}
	if !l.Allow("alice", "10.0.0.2", now) {
		t.Fatal("login-name lock must not block the same login from another IP")
	}
	if l.Allow("alice", "10.0.0.1", now) {
		t.Fatal("same login+ip should be locked")
	}
	if l.Allow("bob", "10.0.0.1", now) {
		t.Fatal("ip lock should block other logins from same IP")
	}
	if !l.Allow("bob", "10.0.0.2", now) {
		t.Fatal("different login+ip should still allow")
	}
}

// Success from one IP clears only that login+IP pair; the same login's pair on another IP stays (#171).
func TestLoginAttemptLimiterSuccessClearsOnlyOwnPair(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter().(*memoryLoginAttemptLimiter)
	now := time.Now().UTC()
	const ipA, ipB = "10.0.0.1", "10.0.0.2"
	l.RecordFailure("alice", ipA, now)
	l.RecordFailure("alice", ipB, now)
	l.RecordSuccess("alice", ipB)
	if _, ok := l.byKey[loginAttemptKey("alice", ipB)]; ok {
		t.Fatal("success must clear its own login+ip pair key")
	}
	e := l.byKey[loginAttemptKey("alice", ipA)]
	if e == nil || e.failures != 1 {
		t.Fatalf("pair key on another IP must survive: %+v", e)
	}
}

func TestLoginAttemptLimiterPrunesStaleFailures(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 4; i++ {
		l.RecordFailure("ghost", "8.8.8.8", now)
	}
	later := now.Add(loginFailureTTL + time.Second)
	if !l.Allow("ghost", "8.8.8.8", later) {
		t.Fatal("stale failures should not leave a lock")
	}
	// One new failure after prune must not immediately lock (need 5 fresh).
	l.RecordFailure("ghost", "8.8.8.8", later)
	if !l.Allow("ghost", "8.8.8.8", later) {
		t.Fatal("single failure after prune should still allow")
	}
}

// IPv6 clients usually own a whole /64, so rotating addresses inside it must not reset the IP lock.
func TestLoginAttemptLimiterBucketsIPv6By64(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("u"+strconv.Itoa(i), "2001:db8:1:2::"+strconv.FormatInt(int64(i+1), 16), now)
	}
	if l.Allow("other", "2001:db8:1:2:ffff::9", now) {
		t.Fatal("another address in the same /64 must share the IP lock")
	}
	if !l.Allow("other", "2001:db8:1:3::1", now) {
		t.Fatal("a different /64 must not be locked")
	}
}

func TestRateLimitIPBucket(t *testing.T) {
	cases := []struct{ in, want string }{
		{"203.0.113.9", "203.0.113.9"},
		{"::ffff:203.0.113.9", "203.0.113.9"},
		{"2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"},
		{"2001:DB8:1:2::7", "2001:db8:1:2::/64"},
		{"not-an-ip", "not-an-ip"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := rateLimitIPBucket(tc.in); got != tc.want {
			t.Errorf("rateLimitIPBucket(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

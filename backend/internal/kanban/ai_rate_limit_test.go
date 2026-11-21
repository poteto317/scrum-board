package kanban

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSlidingAIRateLimiterDisabled(t *testing.T) {
	l := NewSlidingAIRateLimiter(0)
	if l.Enabled() {
		t.Fatal("want disabled")
	}
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < 50; i++ {
		if !l.Try(1, now) {
			t.Fatalf("noop must allow, i=%d", i)
		}
	}
}

func TestSlidingAIRateLimiterThreshold(t *testing.T) {
	l := NewSlidingAIRateLimiter(2)
	now := time.Unix(1_700_000_000, 0)
	if !l.Try(1, now) {
		t.Fatal("1st")
	}
	if !l.Try(1, now.Add(time.Second)) {
		t.Fatal("2nd")
	}
	if l.Try(1, now.Add(2*time.Second)) {
		t.Fatal("3rd must reject")
	}
	if !l.Try(1, now.Add(aiRateWindow+time.Second)) {
		t.Fatal("after window should allow")
	}
}

func TestSlidingAIRateLimiterReleaseFreesSlot(t *testing.T) {
	l := NewSlidingAIRateLimiter(1)
	now := time.Unix(1_700_000_000, 0)
	if !l.Try(1, now) {
		t.Fatal("reserve")
	}
	l.Release(1, now)
	if !l.Try(1, now) {
		t.Fatal("after Release should allow")
	}
}

func TestSlidingAIRateLimiterPerUser(t *testing.T) {
	l := NewSlidingAIRateLimiter(1)
	now := time.Unix(1_700_000_000, 0)
	if !l.Try(1, now) {
		t.Fatal("user1")
	}
	if l.Try(1, now) {
		t.Fatal("user 1 blocked")
	}
	if !l.Try(2, now) {
		t.Fatal("user 2 independent")
	}
}

func TestSlidingAIRateLimiterParallelCap(t *testing.T) {
	const n = 5
	l := NewSlidingAIRateLimiter(n)
	now := time.Unix(1_700_000_000, 0)
	var okCount atomic.Int32
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Try(1, now) {
				okCount.Add(1)
			}
		}()
	}
	wg.Wait()
	if got := okCount.Load(); got != n {
		t.Fatalf("parallel Try ok=%d want=%d", got, n)
	}
}

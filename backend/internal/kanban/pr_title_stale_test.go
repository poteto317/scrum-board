package kanban

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPRTitleResolverServesAnExpiredTitleWithoutWaitingForGitHub(t *testing.T) {
	url := "https://github.com/o/r/pull/7"
	clock := newFakeClock()
	rt := newSlowTransport(func(n int32) *http.Response {
		if n == 1 {
			return titleResponse("Old")
		}
		return titleResponse("New")
	})
	close(rt.release) // the first fetch answers at once
	r := newResolverAt(rt, clock)
	ctx := context.Background()
	if got := r.Resolve(ctx, url); got != "Old" {
		t.Fatalf("first %q", got)
	}
	clock.advance(prTitleCacheTTL + time.Second)
	rt.release = make(chan struct{}) // the refresh now hangs until released
	start := time.Now()
	if got := r.Resolve(ctx, url); got != "Old" {
		t.Fatalf("expired entry must still be served, got %q", got)
	}
	if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
		t.Fatalf("Resolve waited %v for GitHub", elapsed)
	}
	close(rt.release)
	eventually(t, "the background refresh", func() bool { return r.Resolve(ctx, url) == "New" })
}

func TestPRTitleResolverServesAnExpiredFailureWithoutWaitingForGitHub(t *testing.T) {
	url := "https://github.com/o/r/pull/8"
	clock := newFakeClock()
	rt := newSlowTransport(func(int32) *http.Response { return failureResponse() })
	close(rt.release)
	r := newResolverAt(rt, clock)
	ctx := context.Background()
	if got := r.Resolve(ctx, url); got != "o/r#8" {
		t.Fatalf("first %q", got)
	}
	clock.advance(prTitleCacheTTLFailure + time.Second)
	rt.release = make(chan struct{})
	start := time.Now()
	if got := r.Resolve(ctx, url); got != "o/r#8" {
		t.Fatalf("got %q", got)
	}
	if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
		t.Fatalf("Resolve waited %v for GitHub", elapsed)
	}
	close(rt.release)
}

func TestPRTitleResolverKeepsTheLastTitleWhenARefreshFails(t *testing.T) {
	url := "https://github.com/o/r/pull/9"
	clock := newFakeClock()
	rt := newSlowTransport(func(n int32) *http.Response {
		if n == 1 {
			return titleResponse("Old")
		}
		return failureResponse()
	})
	close(rt.release)
	r := newResolverAt(rt, clock)
	ctx := context.Background()
	r.Resolve(ctx, url)
	clock.advance(prTitleCacheTTL + time.Second)
	if got := r.Resolve(ctx, url); got != "Old" {
		t.Fatalf("got %q", got)
	}
	eventually(t, "the failed refresh", func() bool { return rt.calls.Load() == 2 && r.idle() })
	if got := r.Resolve(ctx, url); got != "Old" {
		t.Fatalf("a failed refresh must not replace the title with the fallback, got %q", got)
	}
	if rt.calls.Load() != 2 {
		t.Fatalf("a failure must be cached briefly: %d calls", rt.calls.Load())
	}
}

func TestPRTitleResolverSharesConcurrentFetchesOfOneURL(t *testing.T) {
	url := "https://github.com/o/r/pull/10"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("Shared") })
	r := NewPRTitleResolver(rt, "")
	const callers = 10
	var wg sync.WaitGroup
	got := make([]string, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i] = r.Resolve(context.Background(), url)
		}(i)
	}
	eventually(t, "the fetch to start", func() bool { return rt.calls.Load() >= 1 })
	// The other callers arrive within moments; a fetch is slow (held back) until they have.
	time.Sleep(50 * time.Millisecond)
	close(rt.release)
	wg.Wait()
	if rt.calls.Load() != 1 {
		t.Fatalf("%d GitHub calls for %d callers", rt.calls.Load(), callers)
	}
	for i, g := range got {
		if g != "Shared" {
			t.Fatalf("caller %d got %q", i, g)
		}
	}
}

func TestPRTitleResolverDropsAnOldTitleWhenRefreshesKeepFailing(t *testing.T) {
	url := "https://github.com/o/r/pull/11"
	clock := newFakeClock()
	rt := newSlowTransport(func(n int32) *http.Response {
		if n == 1 {
			return titleResponse("Old")
		}
		return failureResponse() // e.g. the PR was deleted or the repository made private
	})
	close(rt.release)
	r := newResolverAt(rt, clock)
	ctx := context.Background()
	r.Resolve(ctx, url)
	clock.advance(prTitleStaleMaxAge + time.Minute)
	if got := r.Resolve(ctx, url); got != "Old" {
		t.Fatalf("the expired title is still served while refreshing, got %q", got)
	}
	eventually(t, "the failed refresh", func() bool { return rt.calls.Load() == 2 && r.idle() })
	if got := r.Resolve(ctx, url); got != "o/r#11" {
		t.Fatalf("a title that could not be refreshed for too long must go, got %q", got)
	}
}

func TestPRTitleResolverDoesNotCacheWaitingForASlotAsAGitHubFailure(t *testing.T) {
	first := "https://github.com/o/r/pull/12"
	second := "https://github.com/o/r/pull/13"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("T") })
	r := NewPRTitleResolver(rt, "")
	r.slots = make(chan struct{}, 1)
	r.slotWait = 50 * time.Millisecond
	done := make(chan string, 1)
	go func() { done <- r.Resolve(context.Background(), first) }() // takes the only slot and hangs
	eventually(t, "the first fetch to start", func() bool { return rt.calls.Load() == 1 })
	if got := r.Resolve(context.Background(), second); got != "o/r#13" {
		t.Fatalf("got %q", got)
	}
	eventually(t, "the second fetch to give up waiting", r.idleExcept(first))
	close(rt.release)
	<-done
	if got := r.Resolve(context.Background(), second); got != "T" {
		t.Fatalf("a URL that never reached GitHub must be asked again at once, got %q", got)
	}
}

func TestPRTitleResolverReleasesAURLWhenTheFetchPanics(t *testing.T) {
	url := "https://github.com/o/r/pull/14"
	var calls atomic.Int32
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			panic("boom")
		}
		return titleResponse("After"), nil
	})
	clock := newFakeClock()
	r := newResolverAt(rt, clock)
	if got := r.Resolve(context.Background(), url); got != "o/r#14" {
		t.Fatalf("got %q", got)
	}
	if !r.idle() {
		t.Fatal("the URL stays marked as being fetched after a panic")
	}
	clock.advance(prTitleCacheTTLFailure + time.Second)
	r.Resolve(context.Background(), url)
	eventually(t, "the refresh after the panic", func() bool { return r.Resolve(context.Background(), url) == "After" })
}

func TestPRTitleResolverFillsTheCacheEvenWhenTheCallerGivesUp(t *testing.T) {
	url := "https://github.com/o/r/pull/15"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("Late") })
	r := NewPRTitleResolver(rt, "")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if got := r.Resolve(ctx, url); got != "o/r#15" {
		t.Fatalf("got %q", got)
	}
	close(rt.release)
	eventually(t, "the late answer", func() bool { return r.Resolve(context.Background(), url) == "Late" })
	if rt.calls.Load() != 1 {
		t.Fatalf("%d GitHub calls", rt.calls.Load())
	}
}

func TestPRTitleResolverDoesNotAskAgainWhenAnAnswerArrivedMeanwhile(t *testing.T) {
	url := "https://github.com/o/r/pull/16"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("Once") })
	close(rt.release)
	r := NewPRTitleResolver(rt, "")
	r.Resolve(context.Background(), url)
	// A caller that looked at the cache just before the answer was stored starts a fetch now.
	f := r.startFetch(url, "o/r#16")
	<-f.done
	if rt.calls.Load() != 1 || f.label != "Once" {
		t.Fatalf("%d GitHub calls, label %q", rt.calls.Load(), f.label)
	}
}

func TestPRTitleResolverHandsOutOneFlightPerURL(t *testing.T) {
	url := "https://github.com/o/r/pull/17"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("One") })
	r := NewPRTitleResolver(rt, "")
	first := r.startFetch(url, "o/r#17")
	second := r.startFetch(url, "o/r#17")
	if first != second {
		t.Fatal("a second caller asking while the request is in flight must share it")
	}
	close(rt.release)
	<-first.done
	if first.label != "One" || rt.calls.Load() != 1 {
		t.Fatalf("label %q, %d GitHub calls", first.label, rt.calls.Load())
	}
}

func TestPRTitleResolverStopsWaitingForAFirstAnswerAfterFirstWait(t *testing.T) {
	url := "https://github.com/o/r/pull/18"
	rt := newSlowTransport(func(int32) *http.Response { return titleResponse("Late") })
	r := NewPRTitleResolver(rt, "")
	r.firstWait = 30 * time.Millisecond
	start := time.Now()
	if got := r.Resolve(context.Background(), url); got != "o/r#18" {
		t.Fatalf("got %q", got)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("waited %v for a first answer", elapsed)
	}
	close(rt.release)
	eventually(t, "the late answer", func() bool { return r.Resolve(context.Background(), url) == "Late" })
}

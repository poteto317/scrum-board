package kanban

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock lets a test move the resolver's clock past the cache lifetimes.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{t: time.Unix(1_700_000_000, 0)} }

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func titleResponse(title string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"title":"` + title + `"}`))}
}

func failureResponse() *http.Response {
	return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader(`{}`))}
}

// eventually polls cond for up to a second; the refresh runs in the background.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// slowTransport answers with respond() only after release is closed.
type slowTransport struct {
	calls   atomic.Int32
	release chan struct{}
	respond func(call int32) *http.Response
}

func newSlowTransport(respond func(call int32) *http.Response) *slowTransport {
	return &slowTransport{release: make(chan struct{}), respond: respond}
}

func (s *slowTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	n := s.calls.Add(1)
	select {
	case <-s.release:
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}
	return s.respond(n), nil
}

func newResolverAt(rt http.RoundTripper, clock *fakeClock) *PRTitleResolver {
	r := NewPRTitleResolver(rt, "")
	r.now = clock.now
	return r
}

// idle reports whether no GitHub request is in progress (tests wait for background refreshes).
func (r *PRTitleResolver) idle() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.inflight) == 0
}

// idleExcept is idle() ignoring one URL (a test keeps one request hanging on purpose).
func (r *PRTitleResolver) idleExcept(prURL string) func() bool {
	return func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		_, busy := r.inflight[prURL]
		return len(r.inflight) == 0 || (len(r.inflight) == 1 && busy)
	}
}

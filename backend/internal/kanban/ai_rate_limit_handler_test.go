package kanban

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type countingAIRateLimiter struct {
	mu      sync.Mutex
	tries   int
	release int
	allow   bool
}

func (l *countingAIRateLimiter) Enabled() bool { return true }
func (l *countingAIRateLimiter) Try(int64, time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tries++
	return l.allow
}
func (l *countingAIRateLimiter) Release(int64, time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.release++
}
func (l *countingAIRateLimiter) counts() (tries, release int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.tries, l.release
}

func TestAIRateLimitBlocksChatAndRefined(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "ok", 1, 1, nil
	}}
	formatter := &fakeFormatter{fn: ok("題名", "説明")}
	limits := DefaultAILimits()
	limits.RatePerMinute = 1
	h := NewHandler(repo, WithAIChat(chatter), WithItemFormatter(formatter), WithAILimits(limits))

	w := request(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`)
	if w.Code != 200 {
		t.Fatalf("first chat: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "POST", aiChatPath(card.Number), `{"message":"again"}`)
	if w.Code != 429 {
		t.Fatalf("second chat: want 429, got %d %s", w.Code, w.Body.String())
	}
	errBody := decodeError(t, w)
	if errBody.Code != "ai_rate_limit" || errBody.Message != msgAIRateLimit {
		t.Fatalf("chat rate body: %+v", errBody)
	}
	if chatter.calls != 1 {
		t.Fatalf("chatter calls=%d", chatter.calls)
	}

	w = request(h, "POST", "/api/items/refined", `{"title":"下書きタイトルです"}`)
	if w.Code != 429 {
		t.Fatalf("refined: want 429, got %d %s", w.Code, w.Body.String())
	}
	errBody = decodeError(t, w)
	if errBody.Code != "ai_rate_limit" || errBody.Message != msgAIRateLimit {
		t.Fatalf("refined rate body: %+v", errBody)
	}
}

func TestAIRateLimitDisabledDoesNotReject(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		return "ok", 1, 1, nil
	}}
	h := NewHandler(repo, WithAIChat(chatter))
	for i := 0; i < 5; i++ {
		w := request(h, "POST", aiChatPath(card.Number), `{"message":"hi"}`)
		if w.Code != 200 {
			t.Fatalf("i=%d: %d %s", i, w.Code, w.Body.String())
		}
	}
}

func TestAIRateLimitBusyReleasesReservation(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	release := make(chan struct{})
	f := &fakeFormatter{fn: func(context.Context, Draft) (RefinedItem, int64, int64, error) {
		<-release
		return RefinedItem{}, 0, 0, context.Canceled
	}}
	lim := &countingAIRateLimiter{allow: true}
	h := NewHandler(repo, WithItemFormatter(f), WithAIRateLimiter(lim))

	var wg sync.WaitGroup
	for range maxConcurrentFormats {
		wg.Add(1)
		go func() { defer wg.Done(); postJSON(h, `{"title":"下書きタイトルです"}`) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for f.callCount() < maxConcurrentFormats {
		if time.Now().After(deadline) {
			t.Fatal("formatter calls did not start")
		}
		time.Sleep(time.Millisecond)
	}
	w := postJSON(h, `{"title":"下書きタイトルです"}`)
	if w.Code != 429 || decodeError(t, w).Code != "ai_busy" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	tries, releases := lim.counts()
	if tries != maxConcurrentFormats+1 || releases != 1 {
		t.Fatalf("busy must Release once: tries=%d releases=%d", tries, releases)
	}
	close(release)
	wg.Wait()
}

func TestAIChatMessageMaxOverride(t *testing.T) {
	repo := fresh()
	card, _ := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	chatter := &fakeChatter{fn: func(context.Context, string, []ChatTurn) (string, int64, int64, error) {
		t.Fatal("must not chat")
		return "", 0, 0, nil
	}}
	limits := DefaultAILimits()
	limits.MessageMax = 10
	h := NewHandler(repo, WithAIChat(chatter), WithAILimits(limits))
	msg := strings.Repeat("あ", 11)
	w := request(h, "POST", aiChatPath(card.Number), fmt.Sprintf(`{"message":%q}`, msg))
	if w.Code != 400 {
		t.Fatalf("want 400, got %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "1〜10文字") {
		t.Fatalf("message should mention 10: %s", w.Body.String())
	}
}

package kanban

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	secretKey   = "SENTINEL-NOT-A-REAL-API-KEY"
	secretDraft = "SENTINEL-DRAFT-body"
	secretReply = "SENTINEL-UPSTREAM-body"
)

// errRepo injects repository errors and counts calls; the embedded memoryRepo provides everything else.
type errRepo struct {
	*memoryRepo
	mu                    sync.Mutex
	colErr, createErr     error
	colCalls, createCalls int
	createDeadline        time.Time
}

func (r *errRepo) GetColumnByName(ctx context.Context, name string) (Column, error) {
	r.mu.Lock()
	r.colCalls++
	err := r.colErr
	r.mu.Unlock()
	if err != nil {
		return Column{}, err
	}
	return r.memoryRepo.GetColumnByName(ctx, name)
}

func (r *errRepo) CreateCard(ctx context.Context, in CardInput) (Card, error) {
	r.mu.Lock()
	r.createCalls++
	r.createDeadline, _ = ctx.Deadline()
	err := r.createErr
	r.mu.Unlock()
	if err != nil {
		return Card{}, err
	}
	return r.memoryRepo.CreateCard(ctx, in)
}

func (r *errRepo) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.colCalls, r.createCalls
}

type fakeFormatter struct {
	mu       sync.Mutex
	calls    int
	drafts   []Draft
	left     []time.Duration // remaining time until the context deadline, when there is one
	hasLimit []bool
	fn       func(context.Context, Draft) (RefinedCard, error)
}

func (f *fakeFormatter) Format(ctx context.Context, d Draft) (RefinedCard, error) {
	f.mu.Lock()
	f.calls++
	f.drafts = append(f.drafts, d)
	deadline, ok := ctx.Deadline()
	f.hasLimit = append(f.hasLimit, ok)
	f.left = append(f.left, time.Until(deadline))
	fn := f.fn
	f.mu.Unlock()
	return fn(ctx, d)
}

func (f *fakeFormatter) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func ok(title, description string) func(context.Context, Draft) (RefinedCard, error) {
	return func(context.Context, Draft) (RefinedCard, error) {
		return RefinedCard{Title: title, Description: description}, nil
	}
}

type failure struct{ kind string }

func (f failure) Error() string {
	return "upstream said " + secretReply + " " + secretKey + " " + secretDraft
}
func (f failure) FailureKind() string { return f.kind }
func (f failure) UpstreamStatus() int { return 500 }

type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func captureLogs(t *testing.T) *logBuffer {
	t.Helper()
	buf := &logBuffer{}
	previous, output, flags := slog.Default(), log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	// slog.SetDefault also redirects the standard log package, and restoring the old logger does not undo that.
	t.Cleanup(func() {
		slog.SetDefault(previous)
		log.SetOutput(output)
		log.SetFlags(flags)
	})
	return buf
}

type apiError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

func post(h http.Handler, ctx context.Context, contentType, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/cards/refined", strings.NewReader(body)).WithContext(ctx)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	h.ServeHTTP(w, r)
	return w
}

func postJSON(h http.Handler, body string) *httptest.ResponseRecorder {
	return post(h, context.Background(), "application/json", body)
}

func newRefined(repo Repository, f CardFormatter) http.Handler {
	if f == nil {
		return NewHandler(repo)
	}
	return NewHandler(repo, WithCardFormatter(f))
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) apiError {
	t.Helper()
	var e apiError
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("body is not JSON: %q", w.Body.String())
	}
	return e
}

func TestRefinedCardIsCreatedInTodoWithTrimmedValues(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	f := &fakeFormatter{fn: ok("  整えた題名  ", "\n整えた説明\n")}
	h := newRefined(repo, f)
	w := post(h, context.Background(), "application/json; charset=utf-8", `{"title":"  下書き題名 ","description":"\n下書き説明  "}`)
	if w.Code != 201 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var card Card
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Title != "整えた題名" || card.Description != "整えた説明" || card.ColumnID != 1 || len(card.PRURLs) != 0 {
		t.Fatalf("card=%+v", card)
	}
	if len(repo.cards) != 1 {
		t.Fatalf("cards=%d", len(repo.cards))
	}
	if f.drafts[0] != (Draft{Title: "下書き題名", Description: "下書き説明"}) {
		t.Fatalf("formatter got %+v, want trimmed draft", f.drafts[0])
	}
}

func TestRefinedCardPassesEmptyTitleAndAcceptsBoundaryLengths(t *testing.T) {
	f := &fakeFormatter{fn: ok("題名", "説明")}
	h := newRefined(&errRepo{memoryRepo: fresh()}, f)
	if w := postJSON(h, `{"description":"説明だけ"}`); w.Code != 201 || f.drafts[0] != (Draft{Description: "説明だけ"}) {
		t.Fatalf("description only: %d %+v", w.Code, f.drafts)
	}
	title, description := strings.Repeat("😀", 200), strings.Repeat("あ", 2000)
	body, _ := json.Marshal(Draft{Title: title, Description: description})
	if w := postJSON(h, string(body)); w.Code != 201 {
		t.Fatalf("boundary lengths: %d %s", w.Code, w.Body)
	}
}

func TestRefinedCardRejectsInvalidInputBeforeAnythingElse(t *testing.T) {
	long := func(n int) string { return strings.Repeat("😀", n) }
	for name, tc := range map[string]struct {
		contentType, body string
		status            int
		code              string
	}{
		"text/plain with valid JSON": {"text/plain", `{"title":"x"}`, 415, "unsupported_media_type"},
		"no content type":            {"", `{"title":"x"}`, 415, "unsupported_media_type"},
		"415 wins over broken JSON":  {"text/plain", `{`, 415, "unsupported_media_type"},
		"broken JSON":                {"application/json", `{`, 400, ""},
		"unknown field":              {"application/json", `{"title":"x","columnId":2}`, 400, ""},
		"empty object":               {"application/json", `{}`, 400, ""},
		"blank values":               {"application/json", `{"title":"  ","description":"\n"}`, 400, ""},
		"title too long":             {"application/json", `{"title":"` + long(201) + `"}`, 400, ""},
		"description too long":       {"application/json", `{"description":"` + long(2001) + `"}`, 400, ""},
		"several JSON values":        {"application/json", `{"title":"x"} {"title":"y"}`, 400, ""},
	} {
		f := &fakeFormatter{fn: ok("題名", "説明")}
		repo := &errRepo{memoryRepo: fresh()}
		w := post(newRefined(repo, f), context.Background(), tc.contentType, tc.body)
		if w.Code != tc.status || (tc.code != "" && decodeError(t, w).Code != tc.code) {
			t.Fatalf("%s: status=%d body=%s", name, w.Code, w.Body)
		}
		if cols, creates := repo.counts(); f.callCount() != 0 || cols != 0 || creates != 0 {
			t.Fatalf("%s: later steps ran (formatter=%d cols=%d creates=%d)", name, f.callCount(), cols, creates)
		}
	}
	// A bad input is a 400 even when the AI is not configured.
	if w := postJSON(NewHandler(fresh()), `{}`); w.Code != 400 {
		t.Fatalf("unconfigured + bad input: %d", w.Code)
	}
}

func TestRefinedCardUnconfiguredIsReportedBeforeResolvingTheColumn(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	w := postJSON(NewHandler(repo), `{"title":"x"}`)
	if w.Code != 503 || decodeError(t, w).Code != "ai_not_configured" {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if cols, _ := repo.counts(); cols != 0 {
		t.Fatal("column was resolved although the AI is not configured")
	}
	// A nil formatter given explicitly means the same.
	if w := postJSON(NewHandler(repo, WithCardFormatter(nil)), `{"title":"x"}`); w.Code != 503 {
		t.Fatalf("nil formatter: %d", w.Code)
	}
	// Existing endpoints do not depend on the formatter.
	if w := request(NewHandler(repo), "GET", "/api/health", ""); w.Code != 200 {
		t.Fatalf("health: %d", w.Code)
	}
}

func TestRefinedCardWithoutTodoColumnFailsBeforeCallingTheAI(t *testing.T) {
	mem := fresh()
	mem.columns = []Column{{ID: 2, Name: "Doing"}}
	f := &fakeFormatter{fn: ok("題名", "説明")}
	w := postJSON(newRefined(&errRepo{memoryRepo: mem}, f), `{"title":"x"}`)
	if w.Code != 500 || decodeError(t, w).Code != "server_error" || f.callCount() != 0 {
		t.Fatalf("status=%d calls=%d body=%s", w.Code, f.callCount(), w.Body)
	}
}

func TestRefinedCardRepositoryErrorsAreServerErrorsWithoutLeaks(t *testing.T) {
	logs := captureLogs(t)
	leaky := errors.New("db said " + secretDraft + " " + secretKey)
	for name, tc := range map[string]struct{ colErr, createErr error }{
		"column unknown":      {colErr: ErrColumn},
		"column duplicate":    {colErr: ErrDuplicate},
		"column not found":    {colErr: ErrNotFound},
		"column leaky":        {colErr: leaky},
		"create unknown":      {createErr: ErrColumn},
		"create duplicate":    {createErr: ErrDuplicate},
		"create not found":    {createErr: ErrNotFound},
		"create leaky":        {createErr: leaky},
		"create wrapped leak": {createErr: errors.Join(ErrColumn, leaky)},
	} {
		repo := &errRepo{memoryRepo: fresh(), colErr: tc.colErr, createErr: tc.createErr}
		w := postJSON(newRefined(repo, &fakeFormatter{fn: ok("題名", "説明")}), `{"title":"`+secretDraft+`"}`)
		if w.Code != 500 || decodeError(t, w).Code != "server_error" {
			t.Fatalf("%s: status=%d body=%s", name, w.Code, w.Body)
		}
		for _, secret := range []string{secretKey, secretDraft, secretReply} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("%s: response leaked %q", name, secret)
			}
		}
	}
	if logs.String() == "" {
		t.Fatal("storage failures must be logged")
	}
	for _, secret := range []string{secretKey, secretDraft, secretReply, "db said"} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("log leaked %q:\n%s", secret, logs.String())
		}
	}
}

func TestRefinedCardRejectsUnusableAIOutputWithoutCreatingACard(t *testing.T) {
	long := func(n int) string { return strings.Repeat("あ", n) }
	for name, tc := range map[string]struct {
		body string
		out  RefinedCard
	}{
		"empty title":                {`{"title":"x"}`, RefinedCard{Title: ""}},
		"blank title":                {`{"title":"x"}`, RefinedCard{Title: " \n "}},
		"title too long":             {`{"title":"x"}`, RefinedCard{Title: long(201)}},
		"invalid UTF-8 title":        {`{"title":"x"}`, RefinedCard{Title: "\xff題名"}},
		"description too long":       {`{"title":"x","description":"y"}`, RefinedCard{Title: "題名", Description: long(10001)}},
		"invalid UTF-8 description":  {`{"title":"x","description":"y"}`, RefinedCard{Title: "題名", Description: "\xff"}},
		"description lost":           {`{"title":"x","description":"y"}`, RefinedCard{Title: "題名", Description: ""}},
		"description became blank":   {`{"title":"x","description":"y"}`, RefinedCard{Title: "題名", Description: " \n"}},
		"derived title still absent": {`{"description":"y"}`, RefinedCard{Title: ""}},
	} {
		repo := &errRepo{memoryRepo: fresh()}
		w := postJSON(newRefined(repo, &fakeFormatter{fn: ok(tc.out.Title, tc.out.Description)}), tc.body)
		if w.Code != 502 || decodeError(t, w).Code != "ai_failed" {
			t.Fatalf("%s: status=%d body=%s", name, w.Code, w.Body)
		}
		if _, creates := repo.counts(); creates != 0 || len(repo.cards) != 0 {
			t.Fatalf("%s: a card was created", name)
		}
	}
}

func TestRefinedCardKeepsADescriptionEmptyWhenTheDraftHadNone(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	w := postJSON(newRefined(repo, &fakeFormatter{fn: ok("題名", "AIが書いた説明")}), `{"title":"下書き"}`)
	var card Card
	_ = json.Unmarshal(w.Body.Bytes(), &card)
	if w.Code != 201 || card.Description != "" {
		t.Fatalf("status=%d description=%q", w.Code, card.Description)
	}
}

func TestRefinedCardAIFailuresNeverCreateACardOrLeak(t *testing.T) {
	logs := captureLogs(t)
	for name, err := range map[string]error{
		"plain error":    errors.New("boom " + secretReply + secretKey + secretDraft),
		"typed failure":  failure{kind: "auth"},
		"canceled":       context.Canceled,
		"deadline":       context.DeadlineExceeded,
		"wrapped secret": errors.Join(errors.New("x"), failure{kind: "server"}),
	} {
		repo := &errRepo{memoryRepo: fresh()}
		f := &fakeFormatter{fn: func(context.Context, Draft) (RefinedCard, error) { return RefinedCard{}, err }}
		w := postJSON(newRefined(repo, f), `{"title":"`+secretDraft+`"}`)
		if w.Code != 502 || decodeError(t, w).Code != "ai_failed" {
			t.Fatalf("%s: status=%d body=%s", name, w.Code, w.Body)
		}
		if _, creates := repo.counts(); creates != 0 || len(repo.cards) != 0 {
			t.Fatalf("%s: a card was created", name)
		}
		for _, secret := range []string{secretKey, secretDraft, secretReply} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("%s: response leaked %q", name, secret)
			}
		}
	}
	if !strings.Contains(logs.String(), "kind=auth") || !strings.Contains(logs.String(), "kind=unknown") {
		t.Fatalf("failure kinds must be logged:\n%s", logs.String())
	}
	for _, secret := range []string{secretKey, secretDraft, secretReply} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("log leaked %q:\n%s", secret, logs.String())
		}
	}
}

func TestRefinedCardLimitsConcurrentAICallsAndAlwaysReleasesTheSlot(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	release := make(chan struct{})
	f := &fakeFormatter{fn: func(context.Context, Draft) (RefinedCard, error) {
		<-release
		return RefinedCard{}, errors.New("stop here") // never reach CreateCard: memoryRepo is not thread safe
	}}
	h := newRefined(repo, f)
	var wg sync.WaitGroup
	for range maxConcurrentFormats {
		wg.Add(1)
		go func() { defer wg.Done(); postJSON(h, `{"title":"x"}`) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for f.callCount() < maxConcurrentFormats {
		if time.Now().After(deadline) {
			t.Fatal("formatter calls did not start")
		}
		time.Sleep(time.Millisecond)
	}
	w := postJSON(h, `{"title":"x"}`)
	if w.Code != 429 || decodeError(t, w).Code != "ai_busy" || f.callCount() != maxConcurrentFormats {
		t.Fatalf("status=%d calls=%d body=%s", w.Code, f.callCount(), w.Body)
	}
	close(release)
	wg.Wait()
	f.fn = ok("題名", "説明")
	if w := postJSON(h, `{"title":"x"}`); w.Code != 201 {
		t.Fatalf("after release: %d %s", w.Code, w.Body)
	}
	for name, fn := range map[string]func(context.Context, Draft) (RefinedCard, error){
		"error": func(context.Context, Draft) (RefinedCard, error) { return RefinedCard{}, errors.New("x") },
		"panic": func(context.Context, Draft) (RefinedCard, error) { panic("formatter exploded") },
	} {
		f2 := &fakeFormatter{fn: fn}
		h2 := newRefined(&errRepo{memoryRepo: fresh()}, f2)
		for i := 0; i <= maxConcurrentFormats; i++ { // one more than the limit: a leaked slot would turn this into a 429
			func() {
				defer func() { _ = recover() }()
				postJSON(h2, `{"title":"x"}`)
			}()
		}
		if f2.callCount() != maxConcurrentFormats+1 {
			t.Fatalf("%s: slot leaked (formatter calls=%d)", name, f2.callCount())
		}
	}
	// A canceled request also frees its slot.
	f3 := &fakeFormatter{fn: func(ctx context.Context, _ Draft) (RefinedCard, error) { return RefinedCard{}, ctx.Err() }}
	h3 := newRefined(&errRepo{memoryRepo: fresh()}, f3)
	for i := 0; i <= maxConcurrentFormats; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		post(h3, ctx, "application/json", `{"title":"x"}`)
	}
	if f3.callCount() != maxConcurrentFormats+1 {
		t.Fatalf("cancel leaked a slot (calls=%d)", f3.callCount())
	}
}

func TestRefinedCardAIDeadlineFollowsTheRemainingRequestTime(t *testing.T) {
	near := func(got, want time.Duration) bool { return got > want-time.Second && got <= want }
	run := func(ctx context.Context) (*fakeFormatter, int) {
		f := &fakeFormatter{fn: ok("題名", "説明")}
		w := post(newRefined(&errRepo{memoryRepo: fresh()}, f), ctx, "application/json", `{"title":"x"}`)
		return f, w.Code
	}
	// The AI deadline is derived inside the handler, so compare it against the context it receives.
	f, code := run(context.Background())
	if code != 201 || !f.hasLimit[0] || !near(f.left[0], maxAIDuration) {
		t.Fatalf("no request deadline: code=%d limited=%v left=%v", code, f.hasLimit, f.left)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if f, code = run(ctx); code != 201 || !near(f.left[0], maxAIDuration) {
		t.Fatalf("long request deadline: code=%d left=%v", code, f.left)
	}
	ctx5, cancel5 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel5()
	if f, code = run(ctx5); code != 201 || !near(f.left[0], 5*time.Second-createReserve) {
		t.Fatalf("5s request deadline: code=%d left=%v", code, f.left)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel2()
	if f, code = run(ctx2); code != 502 || f.callCount() != 0 {
		t.Fatalf("2s request deadline must not call the AI: code=%d calls=%d", code, f.callCount())
	}
	if maxAIDuration+createReserve >= RequestTimeout {
		t.Fatal("AI call and card creation must fit inside the overall request timeout")
	}
}

func TestRefinedCardStoresTheCardWithTheRequestContextNotTheAIContext(t *testing.T) {
	repo := &errRepo{memoryRepo: fresh()}
	f := &fakeFormatter{fn: ok("題名", "説明")}
	ctx, cancel := context.WithTimeout(context.Background(), 14*time.Second)
	defer cancel()
	want, _ := ctx.Deadline()
	if w := post(newRefined(repo, f), ctx, "application/json", `{"title":"x"}`); w.Code != 201 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	repo.mu.Lock()
	got := repo.createDeadline
	repo.mu.Unlock()
	if !got.Equal(want) {
		t.Fatalf("CreateCard got deadline %v, want the request deadline %v (the AI deadline would leave no time to store the card)", got, want)
	}
}

func TestRefinedCardAnswersBusyWithoutWaiting(t *testing.T) {
	release := make(chan struct{})
	f := &fakeFormatter{fn: func(context.Context, Draft) (RefinedCard, error) {
		<-release
		return RefinedCard{}, errors.New("stop here")
	}}
	h := newRefined(&errRepo{memoryRepo: fresh()}, f)
	var wg sync.WaitGroup
	for range maxConcurrentFormats {
		wg.Add(1)
		go func() { defer wg.Done(); postJSON(h, `{"title":"x"}`) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for f.callCount() < maxConcurrentFormats {
		if time.Now().After(deadline) {
			t.Fatal("formatter calls did not start")
		}
		time.Sleep(time.Millisecond)
	}
	start := time.Now()
	w := postJSON(h, `{"title":"x"}`)
	elapsed := time.Since(start)
	close(release)
	wg.Wait()
	if w.Code != 429 || elapsed > 40*time.Millisecond {
		t.Fatalf("status=%d elapsed=%v: a full queue must answer at once", w.Code, elapsed)
	}
}

func TestRefinedCardOtherFailurePathsDoNotLogDraftsOrAIText(t *testing.T) {
	logs := captureLogs(t)
	// Output rejected after the AI answered: the AI text and the draft are both secrets here.
	bad := secretReply + strings.Repeat("あ", 300)
	repo := &errRepo{memoryRepo: fresh()}
	if w := postJSON(newRefined(repo, &fakeFormatter{fn: ok(bad, secretReply)}), `{"title":"`+secretDraft+`","description":"`+secretDraft+`"}`); w.Code != 502 {
		t.Fatalf("invalid output: %d", w.Code)
	}
	// No time left for the AI call.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if w := post(newRefined(repo, &fakeFormatter{fn: ok("題名", "説明")}), ctx, "application/json", `{"title":"`+secretDraft+`"}`); w.Code != 502 {
		t.Fatalf("no time: %d", w.Code)
	}
	if !strings.Contains(logs.String(), "invalid_output") || !strings.Contains(logs.String(), "no_time") {
		t.Fatalf("both paths must be logged:\n%s", logs.String())
	}
	for _, secret := range []string{secretKey, secretDraft, secretReply} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("log leaked %q:\n%s", secret, logs.String())
		}
	}
}

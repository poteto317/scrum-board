package kanban

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

// やり直すのは、ロックの競合（1213・1205）のときだけ、全部で 3 回まで、時間が残っている間だけ。
// 保存（AppendProjectAITurn）と、起動時の引き継ぎ・掃除が、同じ規則を使う。
func TestProjectAILockRetry(t *testing.T) {
	deadlock := &mysql.MySQLError{Number: 1213}
	lockWait := fmt.Errorf("append: %w", &mysql.MySQLError{Number: 1205})
	for _, tc := range []struct {
		name      string
		err       error
		attempt   int
		ctxDone   bool
		wantDelay time.Duration
		wantRetry bool
	}{
		{"stored", nil, 1, false, 0, false},
		{"deadlock on the first try", deadlock, 1, false, projectAILockRetryStep, true},
		{"deadlock on the second try waits longer", deadlock, 2, false, 2 * projectAILockRetryStep, true},
		{"the last try is not followed by another", deadlock, projectAILockAttempts, false, 0, false},
		{"beyond the last try", deadlock, projectAILockAttempts + 1, false, 0, false},
		{"lock wait timeout, wrapped", lockWait, 1, false, projectAILockRetryStep, true},
		{"the caller's time is over", deadlock, 1, true, 0, false},
		{"another MySQL error", &mysql.MySQLError{Number: 1452}, 1, false, 0, false},
		{"not a MySQL error", errors.New("boom"), 1, false, 0, false},
		{"a timeout of the context", context.DeadlineExceeded, 1, false, 0, false},
	} {
		delay, retry := projectAILockRetry(tc.err, tc.attempt, tc.ctxDone)
		if delay != tc.wantDelay || retry != tc.wantRetry {
			t.Errorf("%s: got (%v, %v) want (%v, %v)", tc.name, delay, retry, tc.wantDelay, tc.wantRetry)
		}
	}
}

// やり直しの繰り返し: ロックの競合が続く間だけ、全部で 3 回まで試し、最後の結果を返す。
func TestRetryProjectAILockRace(t *testing.T) {
	deadlock := &mysql.MySQLError{Number: 1213}
	lockWait := fmt.Errorf("delete: %w", &mysql.MySQLError{Number: 1205})
	boom := errors.New("boom")
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	for _, tc := range []struct {
		name      string
		ctx       context.Context
		results   []error // what each try returns, in order
		wantTries int
		wantErr   error
	}{
		{"done at once", t.Context(), []error{nil}, 1, nil},
		{"done after a deadlock and a lock wait timeout", t.Context(), []error{deadlock, lockWait, nil}, 3, nil},
		{"gives up after the last try", t.Context(), []error{deadlock, deadlock, lockWait, nil}, projectAILockAttempts, lockWait},
		{"another error is not tried again", t.Context(), []error{boom, nil}, 1, boom},
		{"not tried again once the caller's time is over", cancelled, []error{deadlock, nil}, 1, deadlock},
	} {
		tries := 0
		err := retryProjectAILockRace(tc.ctx, func() error {
			tries++
			return tc.results[tries-1]
		})
		if tries != tc.wantTries || !errors.Is(err, tc.wantErr) || (tc.wantErr == nil && err != nil) {
			t.Errorf("%s: %d tries, err %v; want %d tries, err %v", tc.name, tries, err, tc.wantTries, tc.wantErr)
		}
	}
}

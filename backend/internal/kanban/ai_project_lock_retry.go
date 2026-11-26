package kanban

import (
	"context"
	"time"
)

// projectAILockAttempts is how often a write to the project chat's tables is tried when InnoDB
// reports a deadlock or a lock wait timeout. Storing an exchange uses it (the answer is paid
// for, so a lost lock race must not lose it), and so do the adoption and the cleanup at start
// (they run beside a serving instance, and a lost lock race must not fail the start).
const projectAILockAttempts = 3

// projectAILockRetryStep is the wait before the second try; each later try waits one step
// longer. InitializeNumbers (numbering.go) has a loop that waits the same way.
const projectAILockRetryStep = 25 * time.Millisecond

// retryProjectAILockRace runs op, and runs it again while it loses a lock race, as
// projectAILockRetry decides. op must be safe to run again: one transaction, or one statement.
func retryProjectAILockRace(ctx context.Context, op func() error) error {
	for attempt := 1; ; attempt++ {
		err := op()
		delay, retry := projectAILockRetry(err, attempt, ctx.Err() != nil)
		if !retry {
			return err
		}
		time.Sleep(delay)
	}
}

// projectAILockRetry decides what follows the attempt-th try (counted from 1): whether to try
// again, and how long to wait first. Only a lost lock race (deadlock 1213, lock wait timeout
// 1205) is tried again, at most projectAILockAttempts times in all, and not once the caller's
// time is over (ctxDone).
func projectAILockRetry(err error, attempt int, ctxDone bool) (delay time.Duration, retry bool) {
	if err == nil || !isMySQLDeadlock(err) || attempt >= projectAILockAttempts || ctxDone {
		return 0, false
	}
	return time.Duration(attempt) * projectAILockRetryStep, true
}

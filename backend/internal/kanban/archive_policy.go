package kanban

import "time"

func effectiveDoneAt(doneAt, latestDoneTransitionAt *time.Time) *time.Time {
	switch {
	case doneAt == nil:
		return latestDoneTransitionAt
	case latestDoneTransitionAt == nil || !latestDoneTransitionAt.After(*doneAt):
		return doneAt
	default:
		return latestDoneTransitionAt
	}
}

func isArchiveDue(effectiveDoneAt *time.Time, cutoff time.Time) bool {
	return effectiveDoneAt != nil && !effectiveDoneAt.After(cutoff)
}

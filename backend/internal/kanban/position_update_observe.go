package kanban

// Optional hooks for integration tests that count SQL in compact / backlog reorder
// hot paths (see L-1084). Production leaves these nil.

var noteCompactMeasuredSQL func()

func countCompactMeasuredSQL() {
	if noteCompactMeasuredSQL != nil {
		noteCompactMeasuredSQL()
	}
}

var noteBacklogReorderMeasuredSQL func()

func countBacklogReorderMeasuredSQL() {
	if noteBacklogReorderMeasuredSQL != nil {
		noteBacklogReorderMeasuredSQL()
	}
}

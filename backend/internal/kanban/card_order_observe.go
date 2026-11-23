package kanban

// noteReorderMeasuredSQL is an optional hook for integration tests that count
// lock→batch UPDATE statements inside ReorderItems (not listOrderedCards/history).
var noteReorderMeasuredSQL func()

func countReorderMeasuredSQL() {
	if noteReorderMeasuredSQL != nil {
		noteReorderMeasuredSQL()
	}
}

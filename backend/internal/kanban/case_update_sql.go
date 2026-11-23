package kanban

import "fmt"

// buildIntCaseColumnUpdateSQL builds
// UPDATE items SET <column>=CASE id WHEN ? THEN ? … END, updated_at=updated_at WHERE id IN (…)
// ids and values must be the same length (one assign per id).
func buildIntCaseColumnUpdateSQL(column string, ids []int64, values []int) (string, []any) {
	if len(ids) != len(values) {
		panic(fmt.Sprintf("buildIntCaseColumnUpdateSQL: len(ids)=%d len(values)=%d", len(ids), len(values)))
	}
	n := len(ids)
	args := make([]any, 0, n*2+n)
	expr := "CASE id"
	for i, id := range ids {
		expr += " WHEN ? THEN ?"
		args = append(args, id, values[i])
	}
	expr += " END"
	query := "UPDATE items SET " + column + "=" + expr + ", updated_at=updated_at WHERE id IN (" + placeholders(n) + ")"
	for _, id := range ids {
		args = append(args, id)
	}
	return query, args
}

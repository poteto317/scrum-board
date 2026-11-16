package kanban

import (
	"strings"
	"unicode/utf8"
)

func validTitle(s string) bool {
	return utf8.ValidString(s) && strings.TrimSpace(s) != "" && utf8.RuneCountInString(s) <= 200
}
func validDescription(s string) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= 10000
}

func validColumnName(name string) bool {
	return utf8.ValidString(name) && strings.TrimSpace(name) != "" && utf8.RuneCountInString(name) <= 60
}

func validateColumnOrder(columnIDs []int64) error {
	if len(columnIDs) == 0 {
		return ErrColumnOrder
	}
	seen := make(map[int64]struct{}, len(columnIDs))
	for _, id := range columnIDs {
		if id <= 0 {
			return ErrColumnOrder
		}
		if _, exists := seen[id]; exists {
			return ErrColumnOrder
		}
		seen[id] = struct{}{}
	}
	return nil
}

func validateItemOrder(orders []ItemColumnOrder) error {
	if len(orders) == 0 {
		return ErrItemOrder
	}
	seenColumns := make(map[int64]struct{}, len(orders))
	seenCards := make(map[int64]struct{})
	for _, order := range orders {
		if order.ColumnID <= 0 {
			return ErrItemOrder
		}
		if _, dup := seenColumns[order.ColumnID]; dup {
			return ErrItemOrder
		}
		seenColumns[order.ColumnID] = struct{}{}
		if order.ItemIDs == nil {
			return ErrItemOrder
		}
		for _, id := range order.ItemIDs {
			if id <= 0 {
				return ErrItemOrder
			}
			if _, dup := seenCards[id]; dup {
				return ErrItemOrder
			}
			seenCards[id] = struct{}{}
		}
	}
	return nil
}

func validateBacklogOrder(cardIDs []int64) error {
	if len(cardIDs) == 0 {
		return ErrBacklogOrder
	}
	seen := make(map[int64]struct{}, len(cardIDs))
	for _, id := range cardIDs {
		if id <= 0 {
			return ErrBacklogOrder
		}
		if _, exists := seen[id]; exists {
			return ErrBacklogOrder
		}
		seen[id] = struct{}{}
	}
	return nil
}

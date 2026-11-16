package kanban

import (
	"strings"
	"testing"
)

func TestNormalizeDraft(t *testing.T) {
	for name, tc := range map[string]struct {
		in      Draft
		want    Draft
		problem bool
	}{
		"trims both":           {Draft{Title: " a ", Description: "\nb\n"}, Draft{Title: "a", Description: "b"}, false},
		"description only":     {Draft{Description: "b"}, Draft{Description: "b"}, false},
		"title only":           {Draft{Title: "a"}, Draft{Title: "a"}, false},
		"both blank":           {Draft{Title: " ", Description: "\t"}, Draft{}, true},
		"title 200 emoji":      {Draft{Title: strings.Repeat("😀", 200)}, Draft{Title: strings.Repeat("😀", 200)}, false},
		"title 201 emoji":      {Draft{Title: strings.Repeat("😀", 201)}, Draft{Title: strings.Repeat("😀", 201)}, true},
		"description 2000":     {Draft{Description: strings.Repeat("あ", 2000)}, Draft{Description: strings.Repeat("あ", 2000)}, false},
		"description 2001":     {Draft{Description: strings.Repeat("あ", 2001)}, Draft{Description: strings.Repeat("あ", 2001)}, true},
		"limit after trimming": {Draft{Title: " " + strings.Repeat("a", 200) + " "}, Draft{Title: strings.Repeat("a", 200)}, false},
	} {
		got, problem := normalizeDraft(tc.in)
		if (problem != "") != tc.problem || (!tc.problem && got != tc.want) {
			t.Fatalf("%s: got %+v problem=%q", name, got, problem)
		}
	}
}

func TestNormalizeRefined(t *testing.T) {
	long := func(n int) string { return strings.Repeat("あ", n) }
	for name, tc := range map[string]struct {
		draft   Draft
		refined RefinedItem
		want    RefinedItem
		valid   bool
	}{
		"trims":                     {Draft{Description: "d"}, RefinedItem{Title: " T ", Description: "\nD\n"}, RefinedItem{Title: "T", Description: "D"}, true},
		"empty draft description":   {Draft{Title: "t"}, RefinedItem{Title: "T", Description: "invented"}, RefinedItem{Title: "T"}, true},
		"lost description":          {Draft{Description: "d"}, RefinedItem{Title: "T"}, RefinedItem{}, false},
		"blank description":         {Draft{Description: "d"}, RefinedItem{Title: "T", Description: " \n"}, RefinedItem{}, false},
		"empty title":               {Draft{Title: "t"}, RefinedItem{}, RefinedItem{}, false},
		"title 200":                 {Draft{Title: "t"}, RefinedItem{Title: long(200)}, RefinedItem{Title: long(200)}, true},
		"title 201":                 {Draft{Title: "t"}, RefinedItem{Title: long(201)}, RefinedItem{}, false},
		"description 10000":         {Draft{Description: "d"}, RefinedItem{Title: "T", Description: long(10000)}, RefinedItem{Title: "T", Description: long(10000)}, true},
		"description 10001":         {Draft{Description: "d"}, RefinedItem{Title: "T", Description: long(10001)}, RefinedItem{}, false},
		"invalid UTF-8 title":       {Draft{Title: "t"}, RefinedItem{Title: "\xff"}, RefinedItem{}, false},
		"invalid UTF-8 description": {Draft{Description: "d"}, RefinedItem{Title: "T", Description: "\xff"}, RefinedItem{}, false},
	} {
		got, valid := normalizeRefined(tc.draft, tc.refined)
		if valid != tc.valid || (valid && got != tc.want) {
			t.Fatalf("%s: got %+v valid=%v", name, got, valid)
		}
	}
}

func TestAcquireSlotNeverBlocksAndReleases(t *testing.T) {
	own := handler{slots: make(chan struct{}, 2)}
	r1, ok1 := own.acquireSlot()
	r2, ok2 := own.acquireSlot()
	_, ok3 := own.acquireSlot()
	if !ok1 || !ok2 || ok3 {
		t.Fatalf("acquire results: %v %v %v", ok1, ok2, ok3)
	}
	r1()
	r3, ok4 := own.acquireSlot()
	if !ok4 {
		t.Fatal("a released slot must be reusable")
	}
	r2()
	r3()
}

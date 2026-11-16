package kanban

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestItemColumnOrderOffsetYsDecode(t *testing.T) {
	for _, tc := range []struct {
		name        string
		raw         string
		wantNil     bool
		want        []int
		wantErr     bool
		wantErrItem bool // true → errors.Is(ErrItemOrder); false → any decode error
	}{
		{"omit", `{"columnId":1,"itemIds":[1]}`, true, nil, false, false},
		{"null", `{"columnId":1,"itemIds":[1],"offsetYs":null}`, true, nil, false, false},
		{"empty", `{"columnId":1,"itemIds":[],"offsetYs":[]}`, false, []int{}, false, false},
		{"ints", `{"columnId":1,"itemIds":[1,2],"offsetYs":[0,160]}`, false, []int{0, 160}, false, false},
		{"float", `{"columnId":1,"itemIds":[1],"offsetYs":[1.5]}`, false, nil, true, true},
		{"string", `{"columnId":1,"itemIds":[1],"offsetYs":["0"]}`, false, nil, true, true},
		{"bool", `{"columnId":1,"itemIds":[1],"offsetYs":[true]}`, false, nil, true, true},
		{"object", `{"columnId":1,"itemIds":[1],"offsetYs":[{}]}`, false, nil, true, true},
		{"unknown field", `{"columnId":1,"itemIds":[1],"extra":true}`, false, nil, true, false},
		{"above max", `{"columnId":1,"itemIds":[1],"offsetYs":[100001]}`, false, nil, true, true},
		{"at max", `{"columnId":1,"itemIds":[1],"offsetYs":[100000]}`, false, []int{100000}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var order ItemColumnOrder
			err := json.Unmarshal([]byte(tc.raw), &order)
			if tc.wantErr {
				if err == nil {
					t.Fatal("want error")
				}
				if tc.wantErrItem && !errors.Is(err, ErrItemOrder) {
					t.Fatalf("err=%v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tc.wantNil {
				if order.OffsetYs != nil {
					t.Fatalf("OffsetYs=%v", order.OffsetYs)
				}
				return
			}
			if order.OffsetYs == nil {
				t.Fatal("OffsetYs nil")
			}
			if len(*order.OffsetYs) != len(tc.want) {
				t.Fatalf("got %v want %v", *order.OffsetYs, tc.want)
			}
			for i := range tc.want {
				if (*order.OffsetYs)[i] != tc.want[i] {
					t.Fatalf("got %v want %v", *order.OffsetYs, tc.want)
				}
			}
		})
	}
}

func TestValidateItemOrderOffsetYs(t *testing.T) {
	offs := func(v ...int) *[]int { return &v }
	for _, tc := range []struct {
		name  string
		order ItemColumnOrder
		ok    bool
	}{
		{"omit ok", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1}}, true},
		{"matching", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1, 2}, OffsetYs: offs(0, 160)}, true},
		{"len mismatch", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1}, OffsetYs: offs(0, 1)}, false},
		{"negative", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1}, OffsetYs: offs(-1)}, false},
		{"above max", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1}, OffsetYs: offs(MaxOffsetY + 1)}, false},
		{"at max", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{1}, OffsetYs: offs(MaxOffsetY)}, true},
		{"empty both", ItemColumnOrder{ColumnID: 1, ItemIDs: []int64{}, OffsetYs: offs()}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateItemOrder([]ItemColumnOrder{tc.order})
			if tc.ok && err != nil {
				t.Fatal(err)
			}
			if !tc.ok && !errors.Is(err, ErrItemOrder) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestReorderItemsOffsetYsHandler(t *testing.T) {
	repo := fresh()
	seedCards(repo)
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "a", Position: 0, OffsetY: 10}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, Title: "b", Position: 1, OffsetY: 20}
	h := NewHandler(repo)

	w := request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[2,1]}]}`)
	if w.Code != 200 {
		t.Fatalf("omit offsetYs: %d %s", w.Code, w.Body)
	}
	if repo.cards[1].OffsetY != 10 || repo.cards[2].OffsetY != 20 {
		t.Fatalf("omit must keep offsets: %+v %+v", repo.cards[1], repo.cards[2])
	}

	w = request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[1,2],"offsetYs":[100,200]}]}`)
	if w.Code != 200 {
		t.Fatalf("set offsetYs: %d %s", w.Code, w.Body)
	}
	if repo.cards[1].OffsetY != 100 || repo.cards[2].OffsetY != 200 {
		t.Fatalf("updated offsets: %+v %+v", repo.cards[1], repo.cards[2])
	}

	for _, tc := range []struct {
		name, body string
	}{
		{"len mismatch", `{"columns":[{"columnId":1,"itemIds":[1,2],"offsetYs":[1]}]}`},
		{"negative", `{"columns":[{"columnId":1,"itemIds":[1,2],"offsetYs":[-1,0]}]}`},
		{"float", `{"columns":[{"columnId":1,"itemIds":[1,2],"offsetYs":[1.5,0]}]}`},
		{"unknown field", `{"columns":[{"columnId":1,"itemIds":[1,2],"extra":true}]}`},
		{"above max", `{"columns":[{"columnId":1,"itemIds":[1,2],"offsetYs":[100001,0]}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before1, before2 := repo.cards[1], repo.cards[2]
			w := request(h, "PUT", "/api/items/order", tc.body)
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
			if !reflect.DeepEqual(repo.cards[1], before1) || !reflect.DeepEqual(repo.cards[2], before2) {
				t.Fatal("invalid request modified cards")
			}
		})
	}
}

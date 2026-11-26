package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

var toolTestColumns = []Column{{ID: 1, Name: "Todo"}, {ID: 2, Name: "Doing"}, {ID: 3, Name: "Done"}}

func TestParseSearchItemsInputDefaultsAndClamps(t *testing.T) {
	plan, problem := parseSearchItemsInput(nil, toolTestColumns)
	if problem != "" || plan.Limit != 10 || plan.Offset != 0 || plan.Search.SortByDue || len(plan.Search.Terms) != 0 || plan.Search.ColumnID != nil {
		t.Fatalf("defaults: %+v %q", plan, problem)
	}
	plan, problem = parseSearchItemsInput(json.RawMessage(`{"query":" 認証  トークン ","status":"doing","assignee":" Sato ","sort":"due","limit":50,"offset":500}`), toolTestColumns)
	if problem != "" {
		t.Fatal(problem)
	}
	if !slices.Equal(plan.Search.Terms, []string{"認証", "トークン"}) || plan.Search.ColumnID == nil || *plan.Search.ColumnID != 2 ||
		plan.Search.Assignee != "Sato" || !plan.Search.SortByDue || plan.Limit != 20 || plan.Offset != 199 || plan.UnknownStatus {
		t.Fatalf("plan=%+v", plan)
	}
	plan, _ = parseSearchItemsInput(json.RawMessage(`{"limit":0,"offset":-3}`), toolTestColumns)
	if plan.Limit != 1 || plan.Offset != 0 {
		t.Fatalf("low values are clamped: %+v", plan)
	}
	plan, problem = parseSearchItemsInput(json.RawMessage(`{"status":"Review"}`), toolTestColumns)
	if problem != "" || !plan.UnknownStatus {
		t.Fatalf("unknown status: %+v %q", plan, problem)
	}
}

func TestParseSearchItemsInputDatesAreTokyoDays(t *testing.T) {
	plan, problem := parseSearchItemsInput(json.RawMessage(`{"dueFrom":"2026-11-26","dueTo":"2026-11-30"}`), toolTestColumns)
	if problem != "" {
		t.Fatal(problem)
	}
	// 11/26 の 0:00（日本時間）以降、12/1 の 0:00（日本時間）より前。
	wantFrom := time.Date(2026, 11, 25, 15, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 11, 30, 15, 0, 0, 0, time.UTC)
	if !plan.Search.DueFrom.Equal(wantFrom) || !plan.Search.DueTo.Equal(wantTo) {
		t.Fatalf("from=%v to=%v", plan.Search.DueFrom, plan.Search.DueTo)
	}
}

func TestParseSearchItemsInputRejectsBadInput(t *testing.T) {
	cases := map[string]string{
		`{"limit":"10"}`:             toolErrInvalidInput,
		`{"limit":1.5}`:              toolErrInvalidInput,
		`{"query":12}`:               toolErrInvalidInput,
		`{"sort":"title"}`:           toolErrInvalidInput,
		`[1,2]`:                      toolErrInvalidInput,
		`{"dueFrom":"11/26"}`:        toolErrDateFormat,
		`{"dueTo":"2026-02-30"}`:     toolErrDateFormat,
		`{"dueFrom":"2026-11-26T0"}`: toolErrDateFormat,
	}
	for raw, want := range cases {
		if _, problem := parseSearchItemsInput(json.RawMessage(raw), toolTestColumns); problem != want {
			t.Fatalf("%s => %q want %q", raw, problem, want)
		}
	}
}

func TestParseGetItemInput(t *testing.T) {
	for raw, want := range map[string]int64{`{"number":12}`: 12, `{"number":12.0}`: 12} {
		if n, ok := parseGetItemInput(json.RawMessage(raw)); !ok || n != want {
			t.Fatalf("%s => %d %v", raw, n, ok)
		}
	}
	for _, raw := range []string{``, `{}`, `null`, `{"number":0}`, `{"number":-1}`, `{"number":"12"}`, `{"number":1.5}`, `{"number":null}`, `"12"`} {
		if n, ok := parseGetItemInput(json.RawMessage(raw)); ok {
			t.Fatalf("%q must be rejected, got %d", raw, n)
		}
	}
}

func TestFitSearchItemsDropsItemsFromTheEnd(t *testing.T) {
	out := searchItemsOut{Total: 20, Items: []searchItemOut{}}
	for i := range 20 {
		out.Items = append(out.Items, searchItemOut{Number: int64(i + 1), Title: strings.Repeat("題", 200), Snippet: strings.Repeat("あ", 200), UpdatedAt: "2026-11-26T00:00:00+09:00"})
	}
	text, ok := fitSearchItems(out, 3000)
	if !ok || utf8.RuneCountInString(text) > 3000 {
		t.Fatalf("ok=%v len=%d", ok, utf8.RuneCountInString(text))
	}
	var got searchItemsOut
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("the cut result must stay valid JSON: %v", err)
	}
	if !got.Truncated || got.Total != 20 || len(got.Items) == 0 || len(got.Items) >= 20 || got.Items[0].Number != 1 {
		t.Fatalf("truncated=%v total=%d items=%d", got.Truncated, got.Total, len(got.Items))
	}
	// 収まるなら、そのまま（truncated は付かない）。
	text, ok = fitSearchItems(out, maxSearchItemsResultChars+10000)
	_ = json.Unmarshal([]byte(text), &got)
	if !ok || got.Truncated || len(got.Items) != 20 {
		t.Fatalf("fits: truncated=%v items=%d", got.Truncated, len(got.Items))
	}
	if _, ok = fitSearchItems(out, 5); ok {
		t.Fatal("nothing fits in 5 characters")
	}
}

func TestFitGetItemDropsOldCommentsThenClipsFields(t *testing.T) {
	item := Item{Number: 7, Title: "題", Description: strings.Repeat("説", 9000), Solution: strings.Repeat("解", 9000), ColumnID: 2}
	var comments []Comment
	base := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	for i := range 40 {
		comments = append(comments, Comment{ID: int64(i + 1), Author: "a", Body: fmt.Sprintf("c%02d %s", i, strings.Repeat("本", 5000)), CreatedAt: base.Add(time.Duration(i) * time.Hour)})
	}
	text, ok := fitGetItem(item, comments, toolTestColumns, maxGetItemResultChars)
	if !ok || utf8.RuneCountInString(text) > maxGetItemResultChars {
		t.Fatalf("ok=%v len=%d", ok, utf8.RuneCountInString(text))
	}
	var got getItemOut
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatal(err)
	}
	// 説明・ソリューション・コメントは 4000 文字（＋「…」）まで。新しいコメントから残る。
	if utf8.RuneCountInString(got.Description) != 4001 || utf8.RuneCountInString(got.Solution) != 4001 || got.Status != "Doing" {
		t.Fatalf("desc=%d sol=%d status=%q", utf8.RuneCountInString(got.Description), utf8.RuneCountInString(got.Solution), got.Status)
	}
	if !got.Truncated || len(got.Comments) == 0 || len(got.Comments) >= 30 || !strings.HasPrefix(got.Comments[0].Body, "c39 ") {
		t.Fatalf("truncated=%v comments=%d first=%.6q", got.Truncated, len(got.Comments), got.Comments[0].Body)
	}
	if utf8.RuneCountInString(got.Comments[0].Body) != 4001 {
		t.Fatalf("comment body=%d", utf8.RuneCountInString(got.Comments[0].Body))
	}
	// 残りの予算が小さいときは、本文をさらに切ってでも収める。
	text, ok = fitGetItem(item, comments, toolTestColumns, 1500)
	if !ok || utf8.RuneCountInString(text) > 1500 || json.Unmarshal([]byte(text), &got) != nil || !got.Truncated || got.Number != 7 {
		t.Fatalf("ok=%v len=%d", ok, utf8.RuneCountInString(text))
	}
	// コメントが 30 件を超えても、切らずに済むなら 30 件（新しい順）。
	small := Item{Number: 1, Title: "t"}
	text, _ = fitGetItem(small, comments[:35], toolTestColumns, 1_000_000)
	_ = json.Unmarshal([]byte(text), &got)
	if len(got.Comments) != 30 || !strings.HasPrefix(got.Comments[0].Body, "c34 ") || !strings.HasPrefix(got.Comments[29].Body, "c05 ") {
		t.Fatalf("comments=%d", len(got.Comments))
	}
}

// ---- executor ----

type toolFixture struct {
	repo   *memoryRepo
	admin  User
	member User
	other  Project
}

func newToolFixture(t *testing.T) *toolFixture {
	t.Helper()
	repo := fresh()
	member, err := repo.CreateUser(context.Background(), UserCreateInput{LoginName: "member1", DisplayName: "メンバー", Password: "member-pass", Role: RoleMember})
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateProject(context.Background(), "別プロジェクト")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	repo.sessions["member-session"] = Session{ID: "member-session", UserID: member.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	return &toolFixture{repo: repo, admin: repo.users[0], member: member, other: other}
}

func (f *toolFixture) item(t *testing.T, in ItemInput) Item {
	t.Helper()
	if in.ColumnID == 0 {
		in.ColumnID = 1
	}
	card, err := f.repo.CreateItem(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return card
}

func (f *toolFixture) exec(user User, projectID int64) *projectToolExecutor {
	return newProjectToolExecutor(f.repo, projectID, &user, f.repo.sortedColumns())
}

func runTool(t *testing.T, e *projectToolExecutor, name, input string) string {
	t.Helper()
	out, err := e.Run(context.Background(), ToolCall{ID: "t", Name: name, Input: json.RawMessage(input)})
	if err != nil {
		t.Fatalf("%s %s: %v", name, input, err)
	}
	return out
}

func searchNumbers(t *testing.T, e *projectToolExecutor, input string) (searchItemsOut, []int64) {
	t.Helper()
	var out searchItemsOut
	raw := runTool(t, e, toolSearchItems, input)
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	numbers := make([]int64, 0, len(out.Items))
	for _, it := range out.Items {
		numbers = append(numbers, it.Number)
	}
	return out, numbers
}

func TestProjectToolsOnlyShowViewableItemsOfTheProject(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	open := f.item(t, ItemInput{Title: "共通 公開"})
	hidden := f.item(t, ItemInput{Title: "共通 制限つき", Description: "SECRET-BODY"})
	if _, err := f.repo.ReplaceItemACL(ctx, hidden.ID, ViewAccessRestricted, EditAccessRestricted, nil, nil); err != nil {
		t.Fatal(err)
	}
	trashed := f.item(t, ItemInput{Title: "共通 ゴミ箱"})
	if err := f.repo.DeleteItem(ctx, trashed.ID); err != nil {
		t.Fatal(err)
	}
	archived := f.item(t, ItemInput{Title: "共通 アーカイブ"})
	at := time.Now().UTC()
	card := f.repo.cards[archived.ID]
	card.ArchivedAt = &at
	f.repo.cards[archived.ID] = card
	elsewhere := f.item(t, ItemInput{Title: "共通 別プロジェクト", ProjectID: &f.other.ID})
	// 別プロジェクトにだけある番号を作る（この番号は、プロジェクト 1 には無い）。
	for range 5 {
		elsewhere = f.item(t, ItemInput{Title: "共通 別プロジェクト", ProjectID: &f.other.ID})
	}

	out, numbers := searchNumbers(t, f.exec(f.member, 1), `{"query":"共通"}`)
	slices.Sort(numbers)
	if !slices.Equal(numbers, []int64{open.Number, archived.Number}) || out.Total != 2 || out.Truncated {
		t.Fatalf("member sees %v total=%d (want %d and %d)", numbers, out.Total, open.Number, archived.Number)
	}
	for _, it := range out.Items {
		if it.Archived != (it.Number == archived.Number) {
			t.Fatalf("archived flag of #%d = %v", it.Number, it.Archived)
		}
	}
	// 管理者は制限つきも見える。ゴミ箱と別プロジェクトは誰にも出ない。
	_, numbers = searchNumbers(t, f.exec(f.admin, 1), `{"query":"共通"}`)
	slices.Sort(numbers)
	if !slices.Equal(numbers, []int64{open.Number, hidden.Number, archived.Number}) {
		t.Fatalf("admin sees %v", numbers)
	}

	// get_item: 存在しない・閲覧できない・ゴミ箱・別プロジェクトだけにある番号は、どれも同じ結果。
	notFound := toolErrorResult(toolErrItemNotFound)
	member := f.exec(f.member, 1)
	for name, number := range map[string]int64{"missing": 9999, "hidden": hidden.Number, "trashed": trashed.Number, "other project": elsewhere.Number} {
		if got := runTool(t, member, toolGetItem, fmt.Sprintf(`{"number":%d}`, number)); got != notFound {
			t.Fatalf("%s: %s", name, got)
		}
	}
	if got := runTool(t, f.exec(f.admin, 1), toolGetItem, fmt.Sprintf(`{"number":%d}`, hidden.Number)); !strings.Contains(got, "SECRET-BODY") {
		t.Fatalf("admin must be able to open it: %s", got)
	}
	// 閲覧の許可リストに入れば見える。
	if _, err := f.repo.ReplaceItemACL(ctx, hidden.ID, ViewAccessRestricted, EditAccessRestricted, []int64{f.member.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if got := runTool(t, f.exec(f.member, 1), toolGetItem, fmt.Sprintf(`{"number":%d}`, hidden.Number)); !strings.Contains(got, "SECRET-BODY") {
		t.Fatalf("allow-listed member: %s", got)
	}
}

func TestSearchItemsMatchesFieldsStatusAndLimit(t *testing.T) {
	f := newToolFixture(t)
	byTitle := f.item(t, ItemInput{Title: "OAuth の導入", Description: "説明A"})
	byDesc := f.item(t, ItemInput{Title: "別件A", Description: "ここで oauth を使う", ColumnID: 2})
	bySolution := f.item(t, ItemInput{Title: "別件B", Solution: "OAUTH で解決"})
	byComment := f.item(t, ItemInput{Title: "別件C"})
	if _, err := f.repo.CreateComment(context.Background(), byComment.ID, "a", "コメントに OAuth と書いた", 1); err != nil {
		t.Fatal(err)
	}
	f.item(t, ItemInput{Title: "無関係"})
	e := f.exec(f.admin, 1)

	_, numbers := searchNumbers(t, e, `{"query":"oauth"}`)
	slices.Sort(numbers)
	if !slices.Equal(numbers, []int64{byTitle.Number, byDesc.Number, bySolution.Number, byComment.Number}) {
		t.Fatalf("title/description/solution/comment: %v", numbers)
	}
	// 番号（#3 でも 3 でも）。
	for _, q := range []string{fmt.Sprintf("#%d", bySolution.Number), fmt.Sprintf("%d", bySolution.Number)} {
		if _, numbers = searchNumbers(t, e, fmt.Sprintf(`{"query":%q}`, q)); !slices.Equal(numbers, []int64{bySolution.Number}) {
			t.Fatalf("number %q: %v", q, numbers)
		}
	}
	// 語は AND。
	if _, numbers = searchNumbers(t, e, `{"query":"oauth 導入"}`); !slices.Equal(numbers, []int64{byTitle.Number}) {
		t.Fatalf("AND: %v", numbers)
	}
	// status（大文字小文字を区別しない）。
	out, numbers := searchNumbers(t, e, `{"query":"oauth","status":"DOING"}`)
	if !slices.Equal(numbers, []int64{byDesc.Number}) || out.Items[0].Status != "Doing" {
		t.Fatalf("status: %v", numbers)
	}
	// 存在しない列名は、検索せずに列名の一覧を返す。
	out, numbers = searchNumbers(t, e, `{"status":"Review"}`)
	if len(numbers) != 0 || out.Total != 0 || out.Truncated || !slices.Equal(out.AvailableStatuses, []string{"Todo", "Doing", "Done"}) {
		t.Fatalf("unknown status: %+v", out)
	}
	// limit。
	out, numbers = searchNumbers(t, e, `{"query":"oauth","limit":2}`)
	if len(numbers) != 2 || out.Total != 4 {
		t.Fatalf("limit: %v total=%d", numbers, out.Total)
	}
	// スニペットは説明の一致の前後。
	out, _ = searchNumbers(t, e, `{"query":"使う"}`)
	if len(out.Items) != 1 || !strings.Contains(out.Items[0].Snippet, "oauth を使う") {
		t.Fatalf("snippet: %+v", out.Items)
	}
}

func TestSearchItemsAssigneeDueSortAndOffset(t *testing.T) {
	f := newToolFixture(t)
	due := func(day int) *time.Time {
		// その日の 10:00（日本時間）。
		v := time.Date(2026, 11, day, 1, 0, 0, 0, time.UTC)
		return &v
	}
	mk := func(title, assignee string, dueAt *time.Time) Item {
		card := f.item(t, ItemInput{Title: title, Assignee: assignee})
		card.DueAt = dueAt
		card.UpdatedAt = time.Date(2026, 11, 1, 0, 0, int(card.ID), 0, time.UTC)
		f.repo.cards[card.ID] = card
		return card
	}
	late := mk("遅い", "Sato", due(30))
	soon := mk("近い", "sato", due(27))
	mid := mk("中間", "Suzuki", due(28))
	none := mk("期限なし", "Sato", nil)
	// 11/29 の 0:30（日本時間）= 11/28 15:30 UTC。日付の境界は日本時間で見る。
	edge := time.Date(2026, 11, 28, 15, 30, 0, 0, time.UTC)
	boundary := mk("境界", "Suzuki", &edge)
	e := f.exec(f.admin, 1)

	// 担当（完全一致、大文字小文字を区別しない）。
	_, numbers := searchNumbers(t, e, `{"assignee":"SATO"}`)
	slices.Sort(numbers)
	if !slices.Equal(numbers, []int64{late.Number, soon.Number, none.Number}) {
		t.Fatalf("assignee: %v", numbers)
	}
	if _, numbers = searchNumbers(t, e, `{"assignee":"Sat"}`); len(numbers) != 0 {
		t.Fatalf("assignee is an exact match: %v", numbers)
	}
	// 期限の近い順。期限なしは最後。
	out, numbers := searchNumbers(t, e, `{"sort":"due"}`)
	if !slices.Equal(numbers, []int64{soon.Number, mid.Number, boundary.Number, late.Number, none.Number}) {
		t.Fatalf("sort due: %v", numbers)
	}
	if out.Items[0].DueAt == nil || *out.Items[0].DueAt != "2026-11-27T10:00:00+09:00" || out.Items[4].DueAt != nil {
		t.Fatalf("dueAt must be written in Asia/Tokyo: %v", out.Items[0].DueAt)
	}
	// 既定は更新の新しい順。
	if _, numbers = searchNumbers(t, e, `{}`); !slices.Equal(numbers, []int64{boundary.Number, none.Number, mid.Number, soon.Number, late.Number}) {
		t.Fatalf("sort updated: %v", numbers)
	}
	// 期限の範囲（両端を含む。期限なしは外れる）。
	if _, numbers = searchNumbers(t, e, `{"dueFrom":"2026-11-28","dueTo":"2026-11-28","sort":"due"}`); !slices.Equal(numbers, []int64{mid.Number}) {
		t.Fatalf("one day: %v", numbers)
	}
	if _, numbers = searchNumbers(t, e, `{"dueFrom":"2026-11-29","sort":"due"}`); !slices.Equal(numbers, []int64{boundary.Number, late.Number}) {
		t.Fatalf("dueFrom: %v", numbers)
	}
	if _, numbers = searchNumbers(t, e, `{"dueTo":"2026-11-28","sort":"due"}`); !slices.Equal(numbers, []int64{soon.Number, mid.Number}) {
		t.Fatalf("dueTo: %v", numbers)
	}
	// offset で続きを取る。total は変わらない。
	out, numbers = searchNumbers(t, e, `{"sort":"due","limit":2,"offset":2}`)
	if !slices.Equal(numbers, []int64{boundary.Number, late.Number}) || out.Total != 5 {
		t.Fatalf("offset: %v total=%d", numbers, out.Total)
	}
	if out, numbers = searchNumbers(t, e, `{"sort":"due","offset":5}`); len(numbers) != 0 || out.Total != 5 {
		t.Fatalf("offset past the end: %v total=%d", numbers, out.Total)
	}
}

// total と truncated は、閲覧できる一致だけで決まる。閲覧できない一致は、200 件の枠も 201 件目の
// 判定も使わない（件数や有無から、制限付きアイテムの中身を探れない）。
func TestSearchItemsTotalAndTruncatedCountOnlyViewableMatches(t *testing.T) {
	f := newToolFixture(t)
	checkSearchCountsOnlyViewableMatches(t, f.repo, f.admin, f.member, f.repo.sortedColumns())
}

func TestSearchItemsHiddenCommentMatchIsNotCounted(t *testing.T) {
	f := newToolFixture(t)
	checkHiddenCommentMatchIsNotCounted(t, f.repo, f.admin, f.member, f.repo.sortedColumns())
}

// 閲覧の判定は検索の中（SQL）で済んでいる。Go の側の判定（二重の検査）が許可の一覧を読むのは、
// 結果に制限付きのアイテムがあるときの 1 回だけ。
func TestSearchItemsReadsAllowlistsOnceForTheSecondCheck(t *testing.T) {
	f := newToolFixture(t)
	for i := range 30 {
		card := f.item(t, ItemInput{Title: fmt.Sprintf("許可 %02d", i)})
		if _, err := f.repo.ReplaceItemACL(context.Background(), card.ID, ViewAccessRestricted, EditAccessOpen, []int64{f.member.ID}, nil); err != nil {
			t.Fatal(err)
		}
	}
	before := f.repo.aclListCalls.Load()
	out, numbers := searchNumbers(t, f.exec(f.member, 1), `{"query":"許可","limit":20}`)
	if out.Truncated || out.Total != 30 || len(numbers) != 20 {
		t.Fatalf("truncated=%v total=%d items=%d", out.Truncated, out.Total, len(numbers))
	}
	if calls := f.repo.aclListCalls.Load() - before; calls != 1 {
		t.Fatalf("allowlists must be read once for the whole page set, got %d", calls)
	}
}

// checkSearchCountsOnlyViewableMatches runs on the memory and the MySQL repository.
func checkSearchCountsOnlyViewableMatches(t *testing.T, repo Repository, admin, member User, columns []Column) {
	t.Helper()
	ctx := context.Background()
	mk := func(title string, hidden bool) Item {
		t.Helper()
		card, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: title})
		if err != nil {
			t.Fatal(err)
		}
		if hidden {
			if _, err := repo.ReplaceItemACL(ctx, card.ID, ViewAccessRestricted, EditAccessOpen, nil, nil); err != nil {
				t.Fatal(err)
			}
		}
		return card
	}
	search := func(user User, input string) (searchItemsOut, []int64) {
		t.Helper()
		return searchNumbers(t, newProjectToolExecutor(repo, 1, &user, columns), input)
	}
	// 閲覧できる 200 件と、それより新しい、メンバーには見えない 10 件。
	hidden := map[int64]bool{}
	for i := range 200 {
		mk(fmt.Sprintf("ZZLEAK 見える %03d", i), false)
	}
	for i := range 10 {
		hidden[mk(fmt.Sprintf("ZZLEAK 見えない %02d", i), true).Number] = true
	}
	// メンバー: 見えない 10 件は、201 件目にも total にも数えない。見える 200 件は、枠を奪われずに全部数える。
	out, _ := search(member, `{"query":"zzleak","limit":20}`)
	if out.Truncated || out.Total != 200 || len(out.Items) != 20 {
		t.Fatalf("member: truncated=%v total=%d items=%d", out.Truncated, out.Total, len(out.Items))
	}
	// 最後のページまで、見える一致が届く（見えない一致に押し出されない）。
	out, numbers := search(member, `{"query":"zzleak","limit":20,"offset":190}`)
	if out.Total != 200 || len(numbers) != 10 {
		t.Fatalf("member last page: total=%d items=%d", out.Total, len(numbers))
	}
	for _, n := range numbers {
		if hidden[n] {
			t.Fatalf("hidden item #%d in the result", n)
		}
	}
	// 検索そのものが、閲覧できないアイテムを返さない。
	rows, err := repo.SearchProjectItems(ctx, 1, ItemSearch{Terms: []string{"zzleak"}, Viewer: itemSearchViewer(&member)})
	if err != nil || len(rows) != 200 {
		t.Fatalf("member rows=%d err=%v", len(rows), err)
	}
	for _, it := range rows {
		if hidden[it.Number] {
			t.Fatalf("the search returned hidden item #%d", it.Number)
		}
	}
	// 管理者には 210 件が見えるので、200 件で打ち切り。
	out, _ = search(admin, `{"query":"zzleak"}`)
	if !out.Truncated || out.Total != 200 {
		t.Fatalf("admin: truncated=%v total=%d", out.Truncated, out.Total)
	}
	// 見える一致が 201 件になって初めて、メンバーにも truncated が付く。
	mk("ZZLEAK 見える 201 件目", false)
	out, _ = search(member, `{"query":"zzleak"}`)
	if !out.Truncated || out.Total != 200 {
		t.Fatalf("member with 201 viewable: truncated=%v total=%d", out.Truncated, out.Total)
	}
}

// checkHiddenCommentMatchIsNotCounted runs on the memory and the MySQL repository.
func checkHiddenCommentMatchIsNotCounted(t *testing.T, repo Repository, admin, member User, columns []Column) {
	t.Helper()
	ctx := context.Background()
	card, err := repo.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "無関係な題名"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ReplaceItemACL(ctx, card.ID, ViewAccessRestricted, EditAccessOpen, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateComment(ctx, card.ID, "admin", "ZZONLYCOMMENT は秘密", admin.ID); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.SearchProjectItems(ctx, 1, ItemSearch{Terms: []string{"zzonlycomment"}, Viewer: itemSearchViewer(&member)})
	if err != nil || len(rows) != 0 {
		t.Fatalf("the search must not return a hidden item for the member: rows=%d err=%v", len(rows), err)
	}
	out, numbers := searchNumbers(t, newProjectToolExecutor(repo, 1, &member, columns), `{"query":"zzonlycomment"}`)
	if out.Total != 0 || out.Truncated || len(numbers) != 0 {
		t.Fatalf("member: total=%d truncated=%v items=%v", out.Total, out.Truncated, numbers)
	}
	out, numbers = searchNumbers(t, newProjectToolExecutor(repo, 1, &admin, columns), `{"query":"zzonlycomment"}`)
	if out.Total != 1 || !slices.Equal(numbers, []int64{card.Number}) {
		t.Fatalf("admin: total=%d items=%v", out.Total, numbers)
	}
}

func TestToolInputProblemsAreFixedTexts(t *testing.T) {
	f := newToolFixture(t)
	e := f.exec(f.admin, 1)
	cases := []struct{ name, input, want string }{
		{toolGetItem, `{"number":0}`, toolErrInvalidInput},
		{toolGetItem, `{"number":"x"}`, toolErrInvalidInput},
		{toolSearchItems, `{"limit":"many"}`, toolErrInvalidInput},
		{toolSearchItems, `{"dueFrom":"tomorrow"}`, toolErrDateFormat},
		{"delete_item", `{"number":1}`, toolErrUnknownTool},
	}
	for _, tc := range cases {
		if got := runTool(t, e, tc.name, tc.input); got != toolErrorResult(tc.want) {
			t.Fatalf("%s %s => %s", tc.name, tc.input, got)
		}
	}
	if e.failure() != nil {
		t.Fatal("input problems must not stop the loop")
	}
}

func TestToolResultsStayWithinPerCallAndTotalLimits(t *testing.T) {
	f := newToolFixture(t)
	var big Item
	for i := range 25 {
		big = f.item(t, ItemInput{Title: fmt.Sprintf("大きい %02d %s", i, strings.Repeat("題", 150)), Description: strings.Repeat("説", 9000), Solution: strings.Repeat("解", 9000)})
	}
	for i := range 35 {
		if _, err := f.repo.CreateComment(context.Background(), big.ID, "a", fmt.Sprintf("%02d %s", i, strings.Repeat("本", 3900)), 1); err != nil {
			t.Fatal(err)
		}
	}
	e := f.exec(f.admin, 1)
	search := runTool(t, e, toolSearchItems, `{"query":"大きい","limit":20}`)
	if n := utf8.RuneCountInString(search); n > maxSearchItemsResultChars {
		t.Fatalf("search result=%d", n)
	}
	var page searchItemsOut
	if err := json.Unmarshal([]byte(search), &page); err != nil || !page.Truncated || page.Total != 25 || len(page.Items) == 0 || len(page.Items) >= 20 {
		t.Fatalf("search must drop items to fit: err=%v truncated=%v items=%d", err, page.Truncated, len(page.Items))
	}
	total := utf8.RuneCountInString(search)
	budgetErr := toolErrorResult(toolErrBudget)
	sawBudgetErr := false
	// 1 メッセージで起こりうる回数（3 回 × 5 件）より多く呼んでも、合計は上限を超えない。
	for range 20 {
		got := runTool(t, e, toolGetItem, fmt.Sprintf(`{"number":%d}`, big.Number))
		n := utf8.RuneCountInString(got)
		if n > maxGetItemResultChars {
			t.Fatalf("get_item result=%d", n)
		}
		if !json.Valid([]byte(got)) {
			t.Fatalf("result must stay valid JSON: %.80s", got)
		}
		if got == budgetErr {
			sawBudgetErr = true
		} else if sawBudgetErr {
			t.Fatal("once the budget is used up, tools must not run again")
		}
		total += n
	}
	if !sawBudgetErr {
		t.Fatal("the budget error must be returned once the total is used up")
	}
	if total > maxProjectChatToolResultChars {
		t.Fatalf("total=%d > %d", total, maxProjectChatToolResultChars)
	}
}

// failingToolRepo makes one repository call of the tools fail.
type failingToolRepo struct {
	*memoryRepo
	searchErr, commentsErr, getErr error
}

func (r *failingToolRepo) SearchProjectItems(ctx context.Context, projectID int64, s ItemSearch) ([]Item, error) {
	if r.searchErr != nil {
		return nil, r.searchErr
	}
	return r.memoryRepo.SearchProjectItems(ctx, projectID, s)
}

func (r *failingToolRepo) ListComments(ctx context.Context, itemID int64) ([]Comment, error) {
	if r.commentsErr != nil {
		return nil, r.commentsErr
	}
	return r.memoryRepo.ListComments(ctx, itemID)
}

func (r *failingToolRepo) GetItemByNumber(ctx context.Context, number, projectID int64) (Item, error) {
	if r.getErr != nil {
		return Item{}, r.getErr
	}
	return r.memoryRepo.GetItemByNumber(ctx, number, projectID)
}

func TestToolRepositoryFailuresStopTheLoopInsteadOfAnswering(t *testing.T) {
	boom := errors.New("SELECT failed at /var/lib/mysql SENTINEL-SQL")
	cases := map[string]struct {
		prepare     func(*failingToolRepo)
		name, input string
	}{
		"search":   {func(r *failingToolRepo) { r.searchErr = boom }, toolSearchItems, `{"query":"x"}`},
		"get":      {func(r *failingToolRepo) { r.getErr = boom }, toolGetItem, `{"number":1}`},
		"comments": {func(r *failingToolRepo) { r.commentsErr = boom }, toolGetItem, `{"number":1}`},
		"acl":      {func(r *failingToolRepo) { r.aclListFail = boom }, toolGetItem, `{"number":1}`},
		"acl list": {func(r *failingToolRepo) { r.aclListFail = boom }, toolSearchItems, `{}`},
	}
	for label, tc := range cases {
		t.Run(label, func(t *testing.T) {
			f := newToolFixture(t)
			card := f.item(t, ItemInput{Title: "x"})
			if _, err := f.repo.ReplaceItemACL(context.Background(), card.ID, ViewAccessRestricted, EditAccessOpen, nil, nil); err != nil {
				t.Fatal(err)
			}
			repo := &failingToolRepo{memoryRepo: f.repo}
			tc.prepare(repo)
			e := newProjectToolExecutor(repo, 1, &f.admin, f.repo.sortedColumns())
			out, err := e.Run(context.Background(), ToolCall{Name: tc.name, Input: json.RawMessage(tc.input)})
			if !errors.Is(err, boom) || out != "" || !errors.Is(e.failure(), boom) {
				t.Fatalf("out=%q err=%v failure=%v", out, err, e.failure())
			}
			// いちど失敗したら、以降のツールも実行しない。
			if out, err = e.Run(context.Background(), ToolCall{Name: toolSearchItems, Input: json.RawMessage(`{}`)}); err == nil || out != "" {
				t.Fatalf("after a failure: out=%q err=%v", out, err)
			}
		})
	}
}

func TestProjectChatToolDefinitions(t *testing.T) {
	tools := projectChatTools()
	if len(tools) != 5 || tools[0].Name != toolSearchItems || tools[1].Name != toolGetItem || tools[2].Name != toolProposeStatusChange ||
		tools[3].Name != toolProposeDescriptionEdit || tools[4].Name != toolProposeItemCreate {
		t.Fatalf("tools=%+v", tools)
	}
	// propose_item_create cannot name a column: the item always goes to Todo.
	if props := tools[4].InputSchema["properties"].(map[string]any); len(props) != 2 || props["title"] == nil || props["description"] == nil {
		t.Fatalf("propose_item_create properties=%v", props)
	}
	for _, tool := range tools {
		if tool.InputSchema["type"] != "object" || tool.Description == "" {
			t.Fatalf("%s: schema=%v", tool.Name, tool.InputSchema)
		}
		// The model is told what decodeToolInput enforces: no fields beyond the listed ones.
		if tool.InputSchema["additionalProperties"] != false {
			t.Fatalf("%s: the schema must forbid unknown fields", tool.Name)
		}
	}
	props := tools[0].InputSchema["properties"].(map[string]any)
	for _, key := range []string{"query", "status", "assignee", "dueFrom", "dueTo", "sort", "limit", "offset"} {
		if _, ok := props[key]; !ok {
			t.Fatalf("search_items lacks %q", key)
		}
	}
	if required := tools[1].InputSchema["required"].([]string); !slices.Equal(required, []string{"number"}) {
		t.Fatalf("get_item required=%v", required)
	}
}

func TestToolInputWithUnknownFieldsIsRejected(t *testing.T) {
	// 項目名の間違い（due_to など）を黙って無視すると、絞り込みなしの検索になる。
	for _, raw := range []string{`{"due_to":"2026-12-01"}`, `{"query":"a","assignee_name":"x"}`} {
		if _, problem := parseSearchItemsInput(json.RawMessage(raw), nil); problem == "" {
			t.Fatalf("search_items must reject unknown fields: %s", raw)
		}
	}
	var in struct {
		Number *float64 `json:"number"`
	}
	if decodeToolInput(json.RawMessage(`{"number":1,"id":2}`), &in) {
		t.Fatal("unknown fields must be rejected")
	}
	if !decodeToolInput(json.RawMessage(`{"number":1}`), &in) || !decodeToolInput(nil, &in) {
		t.Fatal("known fields and empty input stay valid")
	}
}

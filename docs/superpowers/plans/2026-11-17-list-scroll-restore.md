# 一覧スクロール復元 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-list-scroll-restore-design.md`  
> **コミットしない**（`/feature`）。知見: L-002, L-035, L-037, L-040

**Goal:** 詳細から戻るとき、ボード／バックログのスクロール位置を維持し、来た一覧へ戻る。

**Architecture:** 純関数＋`sessionStorage` I/O を `list-scroll-session.ts` に集約。一覧は詳細入場直前に位置と `returnTo` を書き、マウント後に世代付き 1 回復元。詳細の戻る UI は共通 `goBackToList()`（`navigateByUrl`）。削除成功時は board スクロールと `list-return` を消して `/` へ。

**Tech Stack:** Angular / vitest / sessionStorage

## Global Constraints

- `history.back()` 不使用。戻るは `navigateByUrl(returnTo)`。
- 削除後はボードスクロール復元なし（キー削除）。
- 修飾キー／非プライマリボタンの新規タブでは保存しない。
- 壊れた sessionStorage を空オブジェクトで上書きしない（L-002）。
- 復元はスクロール数値のみ。カード `scrollIntoView` しない（L-035）。
- 復元はマウント時 1 回。破棄後・ユーザー操作後の古い復元は適用しない（L-037 / L-040）。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| セッション | Create: `frontend/src/app/list-scroll-session.ts`、`list-scroll-session.spec.ts` |
| ボード | Modify: `frontend/src/app/board.ts`、`board.spec.ts`（html 変更不要・`#boardScroll` 既存） |
| バックログ | Modify: `frontend/src/app/backlog.ts`、`backlog.html`、`backlog.spec.ts` |
| 詳細 | Modify: `frontend/src/app/item-detail.ts`、`item-detail.html`、`item-detail.spec.ts` |
| ページスクロール | 既存 `page-scroll.ts` の `pageScrollElement()` を利用 |

---

### Task 1: list-scroll-session 純関数＋ storage I/O

**Files:**
- Create: `frontend/src/app/list-scroll-session.ts`
- Test: `frontend/src/app/list-scroll-session.spec.ts`

**Interfaces:**
- Produces:
  - `LIST_RETURN_KEY = 'scrumboard:list-return'`
  - `BOARD_SCROLL_KEY = 'scrumboard:scroll:board'`
  - `BACKLOG_SCROLL_KEY = 'scrumboard:scroll:backlog'`
  - `export type ListReturnTo = '/' | '/backlog'`
  - `export type BoardScroll = { scrollY: number; scrollLeft: number }`
  - `export type BacklogScroll = { scrollTop: number; scrollLeft: number }`
  - `parseBoardScroll(raw: string | null): BoardScroll | null`
  - `parseBacklogScroll(raw: string | null): BacklogScroll | null`
  - `parseReturnTo(raw: string | null): ListReturnTo | null`
  - `readBoardScroll(storage?: Storage): BoardScroll | null`
  - `readBacklogScroll(storage?: Storage): BacklogScroll | null`
  - `readReturnTo(storage?: Storage): ListReturnTo | null`
  - `saveBoardScroll(scroll: BoardScroll, storage?: Storage): void`
  - `saveBacklogScroll(scroll: BacklogScroll, storage?: Storage): void`
  - `saveReturnTo(returnTo: ListReturnTo, storage?: Storage): void`
  - `clearReturnTo(storage?: Storage): void`
  - `clearBoardScroll(storage?: Storage): void`
  - `clampNonNegative(n: number): number`（復元時用。負 → 0）
  - `scrollPositionsDiffer(a: number, b: number, epsilon?: number): boolean`（既定 epsilon=1。ユーザー操作スキップ判定）

- [x] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  BOARD_SCROLL_KEY,
  LIST_RETURN_KEY,
  parseBoardScroll,
  parseBacklogScroll,
  parseReturnTo,
  saveBoardScroll,
  saveReturnTo,
  readBoardScroll,
  readReturnTo,
  clearReturnTo,
  clearBoardScroll,
  clampNonNegative,
  scrollPositionsDiffer,
} from './list-scroll-session';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.has(k) ? map.get(k)! : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    key() { return null; },
  };
}

describe('parseBoardScroll', () => {
  it('parses finite numbers', () => {
    expect(parseBoardScroll('{"scrollY":120,"scrollLeft":40}')).toEqual({
      scrollY: 120,
      scrollLeft: 40,
    });
  });
  it('returns null for invalid JSON, NaN, missing fields, non-number', () => {
    expect(parseBoardScroll(null)).toBeNull();
    expect(parseBoardScroll('{')).toBeNull();
    expect(parseBoardScroll('{"scrollY":"x","scrollLeft":1}')).toBeNull();
    expect(parseBoardScroll('{"scrollY":NaN,"scrollLeft":1}')).toBeNull();
    expect(parseBoardScroll('{"scrollY":1}')).toBeNull();
  });
});

describe('parseBacklogScroll', () => {
  it('parses finite numbers and rejects invalid', () => {
    expect(parseBacklogScroll('{"scrollTop":30,"scrollLeft":4}')).toEqual({
      scrollTop: 30,
      scrollLeft: 4,
    });
    expect(parseBacklogScroll('{"scrollTop":Infinity,"scrollLeft":1}')).toBeNull();
    expect(parseBacklogScroll('{"scrollLeft":1}')).toBeNull();
  });
});

describe('parseReturnTo', () => {
  it('accepts only / and /backlog', () => {
    expect(parseReturnTo('{"returnTo":"/"}')).toBe('/');
    expect(parseReturnTo('{"returnTo":"/backlog"}')).toBe('/backlog');
    expect(parseReturnTo('{"returnTo":"/items/1"}')).toBeNull();
    expect(parseReturnTo(null)).toBeNull();
  });
});

describe('scrollPositionsDiffer', () => {
  it('uses epsilon of 1 by default', () => {
    expect(scrollPositionsDiffer(10, 10.4)).toBe(false);
    expect(scrollPositionsDiffer(10, 12)).toBe(true);
  });
});

describe('storage roundtrip', () => {
  it('saves and reads without overwriting bad values with empty object', () => {
    const s = memoryStorage();
    s.setItem(BOARD_SCROLL_KEY, '{broken');
    expect(readBoardScroll(s)).toBeNull();
    expect(s.getItem(BOARD_SCROLL_KEY)).toBe('{broken');
    saveBoardScroll({ scrollY: 10, scrollLeft: 2 }, s);
    expect(readBoardScroll(s)).toEqual({ scrollY: 10, scrollLeft: 2 });
    saveReturnTo('/backlog', s);
    expect(readReturnTo(s)).toBe('/backlog');
    clearReturnTo(s);
    clearBoardScroll(s);
    expect(s.getItem(LIST_RETURN_KEY)).toBeNull();
    expect(s.getItem(BOARD_SCROLL_KEY)).toBeNull();
  });
});

describe('clampNonNegative', () => {
  it('clamps negatives to 0', () => {
    expect(clampNonNegative(-3)).toBe(0);
    expect(clampNonNegative(5)).toBe(5);
  });
});
```

- [x] **Step 2: テスト実行（失敗確認）**

Run: `cd frontend && npx vitest run src/app/list-scroll-session.spec.ts`  
Expected: FAIL（モジュール未作成）

- [x] **Step 3: 実装**

`list-scroll-session.ts` にキー定数・型・parse（`JSON.parse` try/catch、`Number.isFinite` チェック、`returnTo` は厳密等価 `'/'` \| `'/backlog'`）・read（`storage ?? sessionStorage`）・save（`JSON.stringify`）・clear（`removeItem`）・`clampNonNegative`・`scrollPositionsDiffer` を置く。parse 失敗時は `setItem` しない。

- [x] **Step 4: テスト緑**

Run: `cd frontend && npx vitest run src/app/list-scroll-session.spec.ts`  
Expected: PASS

**Done when:** session モジュールのテスト緑。

---

### Task 2: ボード — 保存と復元

**Files:**
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `saveBoardScroll` / `saveReturnTo` / `readBoardScroll` / `clampNonNegative` / `scrollPositionsDiffer`、`pageScrollElement`
- Produces: primary カードクリックで保存。マウント後 1 回 board 復元

- [x] **Step 1: 失敗するテストを board.spec に追加**

既存 `onItemClick` テスト付近に:

```ts
it('saves board scroll and returnTo before navigating to item', async () => {
  // Board を mount。boardScroll.scrollLeft と page scrollTop を設定
  // onItemClick(plain) 後:
  //   readBoardScroll() が { scrollY, scrollLeft }
  //   readReturnTo() === '/'
  // modifier クリックでは save されない（既存 modifier テストと併用可）
});

it('restores board scroll once after render when saved', async () => {
  // sessionStorage をクリア → saveBoardScroll({ scrollY: 80, scrollLeft: 50 })
  // Board を TestBed で mount → detectChanges → whenStable
  // ApplicationRef.tick や fixture 再 detect で afterNextRender を flush
  // expect(pageScrollElement()!.scrollTop).toBe(80)
  // expect(f.nativeElement.querySelector('.board-scroll').scrollLeft).toBe(50)
});

it('does not apply stale board scroll restore after destroy', async () => {
  // saveBoardScroll → mount → 即 destroy → generation が進み復元が no-op
  // （適用前に destroy した場合、スクロールが保存値にならないこと）
});
```

- [ ] **Step 2: テスト実行（失敗確認）**

Run: `cd frontend && npx vitest run src/app/board.spec.ts -t "saves board scroll|restores board scroll"`  
Expected: FAIL

- [ ] **Step 3: 実装**

`board.ts`:

1. import session helpers + `pageScrollElement`（既 import なら追加のみ）。
2. フィールド `private scrollRestoreGeneration = 0`。
3. constructor または `ngOnInit` 直後に復元スケジュール:

```ts
private scheduleBoardScrollRestore() {
  const saved = readBoardScroll();
  if (!saved) return;
  const generation = ++this.scrollRestoreGeneration;
  const page = pageScrollElement();
  const boardEl = this.boardScroll()?.nativeElement;
  // スケジュール時点の位置を基準。適用前にここから動いていればユーザースクロールとみなす。
  const baselineY = page?.scrollTop ?? 0;
  const baselineLeft = boardEl?.scrollLeft ?? 0;
  afterNextRender(
    () => {
      if (generation !== this.scrollRestoreGeneration || this.destroyRef.destroyed) return;
      const pageNow = pageScrollElement();
      const boardNow = this.boardScroll()?.nativeElement;
      if (
        (pageNow && scrollPositionsDiffer(pageNow.scrollTop, baselineY)) ||
        (boardNow && scrollPositionsDiffer(boardNow.scrollLeft, baselineLeft))
      ) {
        return;
      }
      if (pageNow) pageNow.scrollTop = clampNonNegative(saved.scrollY);
      if (boardNow) boardNow.scrollLeft = clampNonNegative(saved.scrollLeft);
    },
    { injector: this.injector },
  );
}
```

ユーザー操作スキップ: **保存値との差ではなく、スケジュール時 baseline からの差**で判定する（マウント直後は 0・保存は非 0 なので、保存値比較だと常にスキップしてしまう）。

4. `DestroyRef.onDestroy` で `this.scrollRestoreGeneration++`。
5. `onItemClick` の `preventDefault` 後・`navigate` 前:

```ts
const page = pageScrollElement();
const boardEl = this.boardScroll()?.nativeElement;
saveBoardScroll({
  scrollY: page?.scrollTop ?? 0,
  scrollLeft: boardEl?.scrollLeft ?? 0,
});
saveReturnTo('/');
void this.router.navigate(['/items', card.number]);
```

- [ ] **Step 4: テスト緑**

Run: `cd frontend && npx vitest run src/app/board.spec.ts`  
Expected: PASS（既存含む）

**Done when:** ボード関連テスト緑。

---

### Task 3: バックログ — 保存と復元

**Files:**
- Modify: `frontend/src/app/backlog.ts`
- Modify: `frontend/src/app/backlog.html`
- Modify: `frontend/src/app/backlog.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `saveBacklogScroll` / `saveReturnTo` / `readBacklogScroll` / `clampNonNegative` / `scrollPositionsDiffer`
- Produces: 「詳細」primary クリックで保存→navigate。マウント後 `.backlog-scroll` 復元

- [ ] **Step 1: 失敗するテスト**

```ts
it('saves backlog scroll and returnTo on detail click', async () => {
  // .backlog-scroll に scrollTop/Left をセット
  // onDetailClick(plain, card) 後 readBacklogScroll / readReturnTo === '/backlog'
});

it('restores backlog scroll once after render when saved', async () => {
  // saveBacklogScroll → mount → scrollTop/Left 復元（baseline 比較。保存値比較はしない）
});

it('does not apply stale backlog scroll restore after destroy', async () => {
  // saveBacklogScroll → mount → 即 destroy → 復元 no-op
});
```

- [ ] **Step 2: 失敗確認**

Run: `cd frontend && npx vitest run src/app/backlog.spec.ts -t "saves backlog scroll|restores backlog scroll"`  
Expected: FAIL

- [ ] **Step 3: 実装**

1. `backlog.html`: `[routerLink]` を外し `(click)="onDetailClick($event, card)"` と `[attr.href]="itemHref(card)"`（または `router.createUrlTree` + `Location.prepareExternalUrl`）。修飾キーは default のまま。
2. `backlog.ts`: `Router`（と必要なら `Location`）を inject。`onDetailClick`:

```ts
onDetailClick(event: MouseEvent, card: Item) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  const el = this.backlogScroll()?.nativeElement;
  saveBacklogScroll({
    scrollTop: el?.scrollTop ?? 0,
    scrollLeft: el?.scrollLeft ?? 0,
  });
  saveReturnTo('/backlog');
  void this.router.navigate(['/items', card.number]);
}
```

3. ボードと同様の世代付き `scheduleBacklogScrollRestore()`（`.backlog-scroll` の top/left。ページ縦は触らない）。スケジュール時 baseline と比較し、適用前に動いていればスキップ。破棄で世代++。

- [ ] **Step 4: テスト緑**

Run: `cd frontend && npx vitest run src/app/backlog.spec.ts`  
Expected: PASS

**Done when:** バックログ関連テスト緑。

---

### Task 4: 詳細 — goBackToList と削除

**Files:**
- Modify: `frontend/src/app/item-detail.ts`
- Modify: `frontend/src/app/item-detail.html`
- Modify: `frontend/src/app/item-detail.spec.ts`

**Interfaces:**
- Consumes: `readReturnTo` / `clearReturnTo` / `clearBoardScroll`
- Produces: `goBackToList()`、`backLinkLabel()`、削除時 clear＋`/`

- [ ] **Step 1: 失敗するテスト**

```ts
it('goBackToList navigates to saved returnTo and clears list-return', () => {
  saveReturnTo('/backlog');
  // ItemDetail mount with router spy
  detail.goBackToList();
  expect(navigateByUrl).toHaveBeenCalledWith('/backlog');
  expect(readReturnTo()).toBeNull();
});

it('goBackToList falls back to / when returnTo missing', () => {
  clearReturnTo();
  detail.goBackToList();
  expect(navigateByUrl).toHaveBeenCalledWith('/');
});

it('delete clears board scroll and list-return then navigates to /', async () => {
  saveReturnTo('/backlog');
  saveBoardScroll({ scrollY: 99, scrollLeft: 1 });
  // trigger successful delete
  expect(readReturnTo()).toBeNull();
  expect(readBoardScroll()).toBeNull();
  expect(navigate).toHaveBeenCalledWith(['/']);
});
```

- [ ] **Step 2: 失敗確認**

Run: `cd frontend && npx vitest run src/app/item-detail.spec.ts -t "goBackToList|delete clears board"`  
Expected: FAIL

- [ ] **Step 3: 実装**

`item-detail.ts`:

```ts
backLinkLabel(): string {
  return readReturnTo() === '/backlog' ? '← バックログに戻る' : '← ボードに戻る';
}

goBackToList() {
  const to = readReturnTo() ?? '/';
  clearReturnTo();
  void this.router.navigateByUrl(to);
}

// delete success:
clearReturnTo();
clearBoardScroll();
this.deleted = true;
void this.router.navigate(['/']);
```

`item-detail.html`:

```html
<a class="back-link" href="#" (click)="$event.preventDefault(); goBackToList()">{{ backLinkLabel() }}</a>
<!-- footer -->
<a class="secondary" href="#" (click)="$event.preventDefault(); goBackToList()">{{ backLinkLabel() }}</a>
```

（`routerLink="/"` を両所から除去。関連アイテムの `routerLink` は触らない。）

- [ ] **Step 4: 全体検証**

Run: `cd frontend && npm test`  
Expected: PASS

**Done when:** 詳細＋回帰緑。コミットしない。

# ライブ再取得（リロードなし反映）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** ボード・バックログ・カード詳細を開いたまま、外部のステータス変更などがフルリロードなしで画面に反映されるようにする。

**Architecture:** `live-refresh.ts` が 5 秒間隔＋ Page Visibility で `fetch` を回し、世代トークンで古い応答を捨てる。各画面は `enabled` ガードと silent `apply`（loading / error UI なし）を渡す。バックエンド変更なし。

**Tech Stack:** Angular 21 / RxJS / TypeScript / Vitest（`ng test`）

**Spec:** `docs/superpowers/specs/2026-11-14-live-board-refresh-design.md`

## Global Constraints

- 間隔は 5000ms。SSE / WebSocket / 新 API / ETag は作らない。
- 背景再取得では `loading` を true にしない。失敗時は前回データを維持し error バナーを出さない。
- 並び替え・保存・モーダル・詳細の未保存／削除中は apply しない。
- 知見: L-040, L-108, L-109, L-217, L-008, L-001。
- `/feature` のため各タスク末尾で git commit しない。

| 知見 | 反映タスク |
| --- | --- |
| L-040 | Task 1 世代 / Task 4 `apply` で `card.number` とルート一致 |
| L-108 / L-109 / L-217 | Task 1 `stop` |
| L-008 | Task 4 未保存時はカードを載せない |
| L-001 | 初回 `load` の成否表示維持・背景失敗は apply しない |

## File Map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/live-refresh.ts` | interval + visibility + 世代付きポーリング |
| `frontend/src/app/live-refresh.spec.ts` | ヘルパー単体テスト |
| `frontend/src/app/board.ts` / `.spec.ts` | ボードの silent 再取得 |
| `frontend/src/app/backlog.ts` / `.spec.ts` | バックログの silent 再取得 |
| `frontend/src/app/card-detail.ts` / `.spec.ts` | 詳細の silent 再取得と未保存ガード |

---

### Task 1: `live-refresh` ヘルパー

**Files:**
- Create: `frontend/src/app/live-refresh.ts`
- Create: `frontend/src/app/live-refresh.spec.ts`

**Interfaces:**
- Consumes: `rxjs`（`Observable`, `Subscription`）, DOM `document`
- Produces:
  ```ts
  export type LiveRefreshOptions<T> = {
    intervalMs?: number; // default 5000
    enabled: () => boolean;
    fetch: () => Observable<T>;
    apply: (data: T) => void;
    document?: Document; // test injection; default global document
  };

  /** Starts polling; returns a stop function. Clears timers and visibility listener (L-108/L-109/L-217). */
  export function startLiveRefresh<T>(options: LiveRefreshOptions<T>): () => void;
  ```

- [x] **Step 1: 失敗するテストを書く**

`frontend/src/app/live-refresh.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { startLiveRefresh } from './live-refresh';

describe('startLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockDoc(hidden: boolean) {
    const listeners = new Map<string, EventListener>();
    return {
      visibilityState: hidden ? 'hidden' : 'visible',
      addEventListener: vi.fn((type: string, fn: EventListener) => listeners.set(type, fn)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
      dispatch(type: string) {
        listeners.get(type)?.(new Event(type));
      },
      setHidden(v: boolean) {
        (this as { visibilityState: string }).visibilityState = v ? 'hidden' : 'visible';
      },
    };
  }

  it('calls fetch on each interval when enabled and visible', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of({ n: 1 }));
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply,
      document: doc as unknown as Document,
    });
    expect(fetch).toHaveBeenCalledTimes(1); // immediate first tick optional — see Step 3: prefer immediate on start
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not fetch when enabled returns false', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 1000,
      enabled: () => false,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    expect(fetch).not.toHaveBeenCalled();
    stop();
  });

  it('stops interval while hidden and fetches once when becoming visible', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    const initial = fetch.mock.calls.length;
    doc.setHidden(true);
    doc.dispatch('visibilitychange');
    vi.advanceTimersByTime(20000);
    expect(fetch.mock.calls.length).toBe(initial);
    doc.setHidden(false);
    doc.dispatch('visibilitychange');
    expect(fetch.mock.calls.length).toBe(initial + 1);
    stop();
  });

  it('does not apply stale responses (generation)', () => {
    const doc = mockDoc(false);
    const slow = new Subject<number>();
    let calls = 0;
    const fetch = vi.fn(() => {
      calls += 1;
      return calls === 1 ? slow.asObservable() : of(2);
    });
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    slow.next(1);
    slow.complete();
    expect(apply).toHaveBeenCalledWith(2);
    expect(apply).not.toHaveBeenCalledWith(1);
    stop();
  });

  it('does not apply on fetch error', () => {
    const doc = mockDoc(false);
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch: () => throwError(() => new Error('net')),
      apply,
      document: doc as unknown as Document,
    });
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('stop clears timers and removes visibility listener', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    const afterStart = fetch.mock.calls.length;
    stop();
    expect(doc.removeEventListener).toHaveBeenCalled();
    vi.advanceTimersByTime(20000);
    expect(fetch.mock.calls.length).toBe(afterStart);
  });
});
```

実装時: 「開始時に即 1 回 fetch」を採用する（仕様の visible 復帰と同様）。テストの期待呼び出し回数をそれに合わせる。

- [x] **Step 2: テストを実行して失敗を確認**

Run: `cd frontend && npx ng test --include=src/app/live-refresh.spec.ts --watch=false`

Expected: FAIL（モジュール未作成）

- [x] **Step 3: 最小実装**

`frontend/src/app/live-refresh.ts`:

```ts
import { Observable, Subscription } from 'rxjs';

export type LiveRefreshOptions<T> = {
  intervalMs?: number;
  enabled: () => boolean;
  fetch: () => Observable<T>;
  apply: (data: T) => void;
  document?: Document;
};

export function startLiveRefresh<T>(options: LiveRefreshOptions<T>): () => void {
  const doc = options.document ?? document;
  const intervalMs = options.intervalMs ?? 5000;
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Subscription | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = () => {
    if (doc.visibilityState === 'hidden') return;
    if (!options.enabled()) return;
    const gen = ++generation;
    inFlight?.unsubscribe();
    inFlight = options.fetch().subscribe({
      next: (data) => {
        if (gen !== generation) return;
        options.apply(data);
      },
      error: () => {
        /* silent */
      },
    });
  };

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      clearTimer();
      return;
    }
    tick();
    clearTimer();
    timer = setInterval(tick, intervalMs);
  };

  const start = () => {
    if (doc.visibilityState === 'hidden') return;
    tick();
    clearTimer();
    timer = setInterval(tick, intervalMs);
  };

  doc.addEventListener('visibilitychange', onVisibility);
  start();

  return () => {
    generation += 1;
    clearTimer();
    inFlight?.unsubscribe();
    inFlight = null;
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
```

- [x] **Step 4: テストを通す**

Run: `cd frontend && npx ng test --include=src/app/live-refresh.spec.ts --watch=false`

Expected: PASS

- [x] **Step 5: コミットしない**（`/feature`）

---

### Task 2: ボードへ接続

**Files:**
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board.spec.ts`

**Interfaces:**
- Consumes: `startLiveRefresh` from `./live-refresh`
- Produces: ボード上で silent に `data` が更新されること

- [x] **Step 1: 失敗するテストを追加**

`board.spec.ts` 末尾に（Api モック＋ fake timers。HttpTestingController は使わない）:

```ts
describe('Board live refresh', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies silent board poll without toggling loading', async () => {
    vi.useFakeTimers();
    const board$ = new Subject<BoardData>();
    const api = { board: vi.fn(() => board$.asObservable()) };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    board$.next(initial);
    board$.complete();
    await f.whenStable();
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.data().cards).toHaveLength(1);

    const polled: BoardData = {
      columns: initial.columns,
      cards: [
        ...initial.cards,
        {
          id: 99,
          number: 99,
          columnId: 1,
          title: 'From poll',
          description: '',
          backlogPosition: 1,
          prUrls: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    api.board.mockReturnValue(of(polled));
    await vi.advanceTimersByTimeAsync(5000);
    await f.whenStable();
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.data().cards.map((c) => c.number)).toContain(99);
  });

  it('does not apply poll while reordering', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    const api = { board: vi.fn(() => of(initial)) };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.reordering.set(true);
    const before = f.componentInstance.data().cards.length;
    api.board.mockReturnValue(
      of({
        ...initial,
        cards: [],
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.data().cards).toHaveLength(before);
  });
});
```

`sampleBoard` が `prUrls` を欠く場合はテストデータに `prUrls: []` を足す。初回 `board$` を Subject にする場合、コンポーネント破棄前に complete すること。実装が「開始時即 tick」なら初回 `api.board` 呼び出しは load＋即 poll の 2 回になりうる — `enabled` が `!loading()` なら初回 load 中は即 tick がスキップされ 1 回。その前提でモック回数を合わせる。

- [x] **Step 2: テスト実行で失敗を確認**

Run: `cd frontend && npx ng test --include=src/app/board.spec.ts --watch=false`

- [x] **Step 3: `board.ts` に接続**

`ngOnInit` 内:

```ts
ngOnInit() {
  this.load();
  const stop = startLiveRefresh({
    enabled: () =>
      !this.loading() && !this.reordering() && !this.saving() && this.modal() === null,
    fetch: () => this.api.board(),
    apply: (d) => {
      const prev = this.data();
      if (JSON.stringify(prev) === JSON.stringify(d)) return;
      this.data.set(d);
    },
  });
  this.destroyRef.onDestroy(stop);
}
```

`load()` は現状どおり `loading` 付き。poll の `apply` では `loading` / `error` を触らない。

- [x] **Step 4: テストを通す**

Run: `cd frontend && npx ng test --include=src/app/board.spec.ts --watch=false`

- [x] **Step 5: コミットしない**

---

### Task 3: バックログへ接続

**Files:**
- Modify: `frontend/src/app/backlog.ts`
- Modify: `frontend/src/app/backlog.spec.ts`

**Interfaces:**
- Consumes: `startLiveRefresh`, `forkJoin`, `api.backlog` / `api.board`
- Produces: silent に `cards` / `columns` 更新

- [x] **Step 1: テスト追加**

```ts
describe('Backlog live refresh', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies silent backlog poll without setting loading', async () => {
    vi.useFakeTimers();
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ cards })),
      board: vi.fn(() => of({ columns, cards: [] })),
      createCard: vi.fn(),
      reorderBacklog: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.loading()).toBe(false);

    const next = [...cards, { ...cards[0], id: 50, number: 50, title: 'Polled' }];
    api.backlog.mockReturnValue(of({ cards: next }));
    await vi.advanceTimersByTimeAsync(5000);
    await f.whenStable();
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.cards().some((c) => c.number === 50)).toBe(true);
  });

  it('does not apply while modal is open', async () => {
    vi.useFakeTimers();
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ cards })),
      board: vi.fn(() => of({ columns, cards: [] })),
      createCard: vi.fn(),
      reorderBacklog: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.modal.set('card');
    const before = f.componentInstance.cards().length;
    api.backlog.mockReturnValue(of({ cards: [] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.cards()).toHaveLength(before);
  });
});
```

- [x] **Step 2: 失敗確認**

Run: `cd frontend && npx ng test --include=src/app/backlog.spec.ts --watch=false`

- [x] **Step 3: `backlog.ts` 接続**

```ts
ngOnInit() {
  this.load();
  const stop = startLiveRefresh({
    enabled: () =>
      !this.loading() &&
      !this.reordering() &&
      !this.saving() &&
      this.modal() === null,
    fetch: () =>
      forkJoin({ backlog: this.api.backlog(), board: this.api.board() }),
    apply: ({ backlog, board }) => {
      const nextCards = backlog.cards;
      const nextCols = board.columns;
      if (JSON.stringify(this.cards()) !== JSON.stringify(nextCards)) {
        this.cards.set(nextCards);
      }
      if (JSON.stringify(this.columns()) !== JSON.stringify(nextCols)) {
        this.columns.set(nextCols);
      }
    },
  });
  this.destroyRef.onDestroy(stop);
}
```

- [x] **Step 4: テストを通す**

Run: `cd frontend && npx ng test --include=src/app/backlog.spec.ts --watch=false`

- [x] **Step 5: コミットしない**

---

### Task 4: カード詳細へ接続

**Files:**
- Modify: `frontend/src/app/card-detail.ts`
- Modify: `frontend/src/app/card-detail.spec.ts`

**Interfaces:**
- Consumes: `startLiveRefresh`, `forkJoin`, `api.board`, `api.cardByNumber`
- Produces: ガード外で columns / card を silent 更新。ルート番号不一致は捨てる（L-040）

- [x] **Step 1: テスト追加**

既存 `CardDetail` の `beforeEach` に `snapshot: { paramMap: { get: (k: string) => params.value.get(k) ?? null } }` を `ActivatedRoute` モックへ足す（poll の `fetch` 用）。

```ts
describe('CardDetail live refresh', () => {
  // 同じ beforeEach セットアップを共有するか、専用 describe で同等モックを用意

  it('refreshes card from poll when no local edits', async () => {
    const f = create();
    await f.whenStable();
    api.cardByNumber.mockReturnValue(
      of({ ...card, title: '外部更新', updatedAt: '2026-11-14T12:00:00Z' }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await f.whenStable();
    expect(f.componentInstance.card()?.title).toBe('外部更新');
    expect(f.componentInstance.loading()).toBe(false);
  });

  it('does not overwrite card while autosave.hasChanges()', async () => {
    const f = create();
    await f.whenStable();
    f.componentInstance.form.controls.title.setValue('編集中');
    expect(f.componentInstance.autosave.hasChanges()).toBe(true);
    api.cardByNumber.mockReturnValue(of({ ...card, title: 'サーバ側' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.form.controls.title.value).toBe('編集中');
    expect(f.componentInstance.card()?.title).not.toBe('サーバ側');
  });

  it('ignores poll for a different card number after navigation', async () => {
    const slow = new Subject<Card>();
    api.cardByNumber.mockReturnValueOnce(of(card)).mockReturnValueOnce(slow.asObservable());
    const f = create();
    await f.whenStable();
    await vi.advanceTimersByTimeAsync(5000); // starts slow poll for #3
    params.next(new Map([['number', '9']]));
    const other = { ...card, id: 90, number: 9, title: '別カード' };
    api.cardByNumber.mockReturnValue(of(other));
    await f.whenStable();
    slow.next({ ...card, title: '遅延した旧カード' });
    slow.complete();
    expect(f.componentInstance.card()?.number).toBe(9);
    expect(f.componentInstance.card()?.title).not.toBe('遅延した旧カード');
  });
});
```

- [x] **Step 2: 失敗確認**

Run: `cd frontend && npx ng test --include=src/app/card-detail.spec.ts --watch=false`

- [x] **Step 3: `card-detail.ts` 接続**

ルート番号は `paramMap` 購読で signal / フィールドに保持し、`fetch` / `apply` の両方で使う（`snapshot` だけに頼らない）。

```ts
private readonly routeNumber = signal(0);

// ngOnInit 内 — 既存 combineLatest と並行:
this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
  this.routeNumber.set(Number(params.get('number')));
});

const stop = startLiveRefresh({
  enabled: () => !this.loading() && this.routeNumber() > 0,
  fetch: () => {
    const number = this.routeNumber();
    return forkJoin({
      board: this.api.board(),
      card: this.api.cardByNumber(number),
    });
  },
  apply: ({ board, card }) => {
    if (card.number !== this.routeNumber()) return; // L-040 ルート不一致
    if (
      this.autosave.hasChanges() ||
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.confirmDelete() ||
      this.deleting()
    ) {
      return;
    }
    this.columns.set(board.columns);
    const next = { ...card, prUrls: card.prUrls ?? [] };
    const current = this.card();
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    this.autosave.reset(next);
  },
});
this.destroyRef.onDestroy(stop);
```

既存の `combineLatest` 初回 load はそのまま。`loading()` 中は poll スキップ。

- [x] **Step 4: テストを通す**

Run: `cd frontend && npx ng test --include=src/app/card-detail.spec.ts --watch=false`

- [x] **Step 5: コミットしない**

---

### Task 5: 全体検証

**Files:** 変更なし（実行のみ）

- [x] **Step 1: フロントの関連テスト一括**

Run: `cd frontend && npx ng test --include=src/app/live-refresh.spec.ts --watch=false && npx ng test --include=src/app/board.spec.ts --watch=false && npx ng test --include=src/app/backlog.spec.ts --watch=false && npx ng test --include=src/app/card-detail.spec.ts --watch=false`

Expected: すべて PASS

- [x] **Step 2: バックエンドに触っていないことを確認**

Run: `git diff --stat -- backend` — 本機能由来の backend 差分なし

- [x] **Step 3: コミットしない**

---

## Spec coverage（自己レビュー）

| 仕様要件 | Task |
| --- | --- |
| 5s ポーリング + visibility | 1 |
| 世代で古い応答破棄 | 1 |
| 背景失敗 silent | 1 |
| ボード silent 更新・ガード | 2 |
| バックログ silent 更新・モーダルガード | 3 |
| 詳細・未保存ガード・ルート番号不一致破棄 | 4 |
| loading を背景で立てない | 2–4 |
| バックエンド変更なし | 5 |
| タイマー破棄 | 1 |

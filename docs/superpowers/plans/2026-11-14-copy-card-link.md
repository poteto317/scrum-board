# カードリンクのワンクリックコピー実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** 詳細画面とかんばんカードから、カード詳細の絶対 URL をワンクリックでクリップボードへコピーできるようにする。

**Architecture:** `card-link.ts` に URL 組み立てとクリップボード書き込みを置き、詳細・ボードが同じ API を呼ぶ。ボードは `.task-card` をコンテナ＋本文リンク＋コピーボタンに組み替え、既存の `↗` をコピーボタンで置き換える。成否は `aria-live` で伝え、消去タイマーは破棄時に解除する。

**Tech Stack:** Angular 21 / TypeScript / Vitest（`ng test`）/ Clipboard API

**Spec:** `docs/superpowers/specs/2026-11-14-copy-card-link-design.md`

## Global Constraints

- コピー URL は `location.origin + '/cards/' + number`（公開番号。内部 ID 禁止）。
- バックエンド・DB・バックログ画面は変更しない。
- PR URL 欄・保存ステータス live 領域は流用せず、コピー専用の feedback を持つ。
- Clipboard は click からの `writeText`＋textarea/`execCommand` フォールバック。copy イベント単体に依存しない。
- 知見: L-001, L-035, L-057, L-108, L-154, L-156, L-441, L-442。
- `/feature` のため各タスク末尾で git commit しない。

## File Map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/card-link.ts` | `cardDetailUrl` / `copyText` |
| `frontend/src/app/card-link.spec.ts` | 上記の単体テスト |
| `frontend/src/app/card-detail.ts` / `.html` / `.css` / `.spec.ts` | 詳細のコピーボタンと可視フィードバック |
| `frontend/src/app/board.ts` / `.html` / `.css` / `.spec.ts` | ボードカード構造変更とコピー |

---

### Task 1: `card-link` ヘルパー

**Files:**
- Create: `frontend/src/app/card-link.ts`
- Create: `frontend/src/app/card-link.spec.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `cardDetailUrl(origin: string, number: number): string`
  - `copyText(text: string): Promise<boolean>`

- [x] **Step 1: 失敗するテストを書く**

`frontend/src/app/card-link.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cardDetailUrl, copyText } from './card-link';

describe('cardDetailUrl', () => {
  it('builds an absolute card detail URL from origin and public number', () => {
    expect(cardDetailUrl('http://127.0.0.1:4200', 27)).toBe(
      'http://127.0.0.1:4200/cards/27',
    );
    expect(cardDetailUrl('http://127.0.0.1:4200/', 3)).toBe(
      'http://127.0.0.1:4200/cards/3',
    );
  });
});

describe('copyText', () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    vi.restoreAllMocks();
  });

  it('returns true when clipboard.writeText resolves', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(copyText('http://example/cards/1')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://example/cards/1');
  });

  it('falls back to execCommand when writeText rejects and returns true on success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const exec = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    await expect(copyText('fallback-url')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('returns false when both clipboard and fallback fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(false);
    await expect(copyText('x')).resolves.toBe(false);
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/card-link.spec.ts`  
Expected: FAIL（モジュール未定義）

- [x] **Step 3: 最小実装を書く**

`frontend/src/app/card-link.ts`:

```ts
export const cardDetailUrl = (origin: string, number: number): string =>
  `${origin.replace(/\/$/, '')}/cards/${number}`;

export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
};
```

- [x] **Step 4: テストが通ることを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/card-link.spec.ts`  
Expected: PASS

---

### Task 2: 詳細画面のコピーボタン

**Files:**
- Modify: `frontend/src/app/card-detail.ts`
- Modify: `frontend/src/app/card-detail.html`
- Modify: `frontend/src/app/card-detail.css`
- Modify: `frontend/src/app/card-detail.spec.ts`

**Interfaces:**
- Consumes: `cardDetailUrl`, `copyText` from Task 1
- Produces: `copyLinkFeedback` signal、`copyCardLink()` メソッド、見出し右上のコピー UI

- [x] **Step 1: 失敗する／既存を壊すテストを追加する**

`card-detail.spec.ts` に、カード表示後:

1. `.copy-card-link` が存在し `aria-label="リンクをコピー"`
2. `navigator.clipboard.writeText` をモックしてボタン click → 呼ばれる引数が `http://…/cards/{number}`（公開番号）
3. 成功後、可視の feedback に「リンクをコピーしました」が含まれる
4. `writeText` と fallback が失敗するとき「リンクをコピーできませんでした」が出る

テスト内では `cardDetailUrl` の origin として `window.location.origin` を使う（実装も同じ）。

- [x] **Step 2: テストが失敗することを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/card-detail.spec.ts`  
Expected: FAIL（セレクタなし）

- [x] **Step 3: テンプレート・スタイル・ロジックを実装**

`card-detail.html` の `.detail-heading` を見出し＋アクションの横並びにする例:

```html
<section class="detail-heading">
  <div class="detail-heading-main">
    <div class="eyebrow">TASK-{{ card()!.number.toString().padStart(3, '0') }}</div>
    <h1>アイテムの詳細</h1>
    <p>取り組むことを明確にして、次のステップへ。</p>
  </div>
  <div class="detail-heading-actions">
    <button
      type="button"
      class="copy-card-link icon-button"
      aria-label="リンクをコピー"
      (click)="copyCardLink()"
    >
      <span aria-hidden="true">🔗</span>
    </button>
    @if (copyLinkFeedback()) {
      <p class="copy-link-feedback" role="status" aria-live="polite">
        {{ copyLinkFeedback() }}
      </p>
    }
  </div>
</section>
```

（絵文字が既存トーンに合わなければ、インライン SVG のリンクアイコンに置き換えてよい。可視アイコン＋ `aria-label` は必須。）

`card-detail.ts` に `import { cardDetailUrl, copyText } from './card-link';` を追加し、クラス内に:

```ts
readonly copyLinkFeedback = signal('');
private copyLinkClearTimer?: ReturnType<typeof setTimeout>;

constructor() {
  // 既存の inject 群の直後でも可。見出しマークアップはカード読込成功の @else 分岐内に置く。
  this.destroyRef.onDestroy(() => {
    if (this.copyLinkClearTimer) clearTimeout(this.copyLinkClearTimer);
  });
}

async copyCardLink() {
  const card = this.card();
  if (!card) return;
  const ok = await copyText(cardDetailUrl(window.location.origin, card.number));
  this.copyLinkFeedback.set(
    ok ? 'リンクをコピーしました' : 'リンクをコピーできませんでした',
  );
  if (this.copyLinkClearTimer) clearTimeout(this.copyLinkClearTimer);
  this.copyLinkClearTimer = setTimeout(() => this.copyLinkFeedback.set(''), 2000);
}
```

CSS: `.detail-heading` を `display: flex; justify-content: space-between; gap: …;`。`.copy-link-feedback` は小さめの可視テキスト（既存 muted 色）。保存用 `.save-state` とは別要素のまま。

- [x] **Step 4: テストが通ることを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/card-detail.spec.ts`  
Expected: PASS

---

### Task 3: かんばんボードのコピーボタンと DOM 組み替え

**Files:**
- Modify: `frontend/src/app/board.html`
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board.css`
- Modify: `frontend/src/app/board.spec.ts`

**Interfaces:**
- Consumes: `cardDetailUrl`, `copyText` from Task 1
- Produces: `.task-card` コンテナ構造、`copyLinkAnnouncement`（または既存 live と別 signal）、`copyCardLink(number: number)`

- [x] **Step 1: 既存ボードテストを新構造に合わせて直し、コピーの失敗テストを足す**

既存（`.task-card` が `<a>` で `href=/cards/2`）を次に更新:

- `.task-card` はコンテナ（`article` または `div`）
- `.task-card-body`（または同等）が `href="/cards/2"` を持つ
- `.copy-card-link` があり、`aria-label="リンクをコピー"`
- `.card-arrow` は存在しない（置き換え）

追加ケース:

1. コピー成功 → live 領域に「リンクをコピーしました」、`Router` 遷移が走らない
2. コピー失敗 → 「リンクをコピーできませんでした」

既存の `aria-live`（列並び替え）と衝突しないよう、コピー用に別の `aria-live` 要素を足すか、同じ polite 領域にコピー用 signal を出す。設計どおり「ボード全体で 1 つのコピー用 live を共有」でよい。並び替え用 `.sr-only` と混ぜる場合はメッセージが上書きされることをテストで固定する。推奨: **コピー専用**の `.sr-only` live を追加し、並び替えと分離する。

- [x] **Step 2: テストが失敗することを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/board.spec.ts`  
Expected: FAIL（構造不一致）

- [x] **Step 3: HTML / CSS / TS を実装**

`board.html` カード部分:

```html
<article class="task-card">
  <button
    type="button"
    class="copy-card-link"
    aria-label="リンクをコピー"
    (click)="copyCardLink(card.number)"
  >
    <span aria-hidden="true">🔗</span>
  </button>
  <a class="task-card-body" [routerLink]="['/cards', card.number]">
    <span class="card-topline">
      <span class="card-id">TASK-{{ card.number.toString().padStart(3, '0') }}</span>
    </span>
    <h3>{{ card.title }}</h3>
    <!-- description / footer は既存どおり -->
  </a>
</article>
```

ボード上部付近に:

```html
<div class="sr-only" aria-live="polite">{{ copyLinkAnnouncement() }}</div>
```

`board.ts` に `import { cardDetailUrl, copyText } from './card-link';` を追加し:

```ts
readonly copyLinkAnnouncement = signal('');
private copyLinkClearTimer?: ReturnType<typeof setTimeout>;

constructor() {
  this.destroyRef.onDestroy(() => {
    if (this.copyLinkClearTimer) clearTimeout(this.copyLinkClearTimer);
  });
}

async copyCardLink(number: number) {
  const ok = await copyText(cardDetailUrl(window.location.origin, number));
  this.copyLinkAnnouncement.set(
    ok ? 'リンクをコピーしました' : 'リンクをコピーできませんでした',
  );
  if (this.copyLinkClearTimer) clearTimeout(this.copyLinkClearTimer);
  this.copyLinkClearTimer = setTimeout(() => this.copyLinkAnnouncement.set(''), 2000);
}
```

CSS: `.task-card` を `position: relative` のブロック容器に。`.task-card-body` に旧 `.task-card` のリンク見た目（decoration none, color inherit, padding 等）を移す。`.copy-card-link` を右上に absolute 配置し、ホバーで押せる十分なヒット領域を確保。

- [x] **Step 4: テストが通ることを確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/board.spec.ts`  
Expected: PASS

---

### Task 4: 全体検証

**Files:**
- 変更なし（確認のみ）。失敗があれば当該タスクに戻って直す。

- [x] **Step 1: フロントのテストとビルド**

Run:

```sh
cd frontend && npx ng test --watch=false
cd frontend && npm run build
```

Expected: すべて PASS / ビルド成功。`anyComponentStyle` 予算超過なし。

- [x] **Step 2: 手動確認メモ（通常 DB を汚さない）**

既存の Doing カード（#27 など）で:

1. ボードのコピー → 別タブ等へ貼ると `/cards/{number}` が開く
2. 詳細のコピー → 同様
3. ボードのコピー後もカードクリックで詳細へ遷移できる

---

## Self-review（プラン作成時）

| Spec 要件 | 担当 Task |
| --- | --- |
| 詳細のリンクアイコン＋絶対 URL コピー | Task 2 |
| ボードのリンクアイコン＋遷移なしコピー | Task 3 |
| 公開番号 `/cards/{number}` | Task 1–3 |
| 成功／失敗フィードバック | Task 2–3 |
| バックエンド変更なし・バックログ対象外 | Global Constraints |
| L-108 タイマー解除 | Task 2–3 |
| Clipboard API＋フォールバック | Task 1 |

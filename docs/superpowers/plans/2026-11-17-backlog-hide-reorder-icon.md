# バックログ並び替えアイコン非表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-backlog-hide-reorder-icon-design.md`  
> **コミットしない**（`/feature`）。知見: L-460, L-472, L-775

**Goal:** プロダクトバックログから `⋮⋮` ハンドルを消し、順位ボタン＋行ドラッグで並び替えできるようにする。

**Architecture:** 見た目のハンドルボタンを削除し、既存の順位表示をフォーカス可能な `<button class="backlog-rank">` に昇格。HTML5 DnD は `.backlog-drag-zone` のまま。キーボード↑↓・フォーカス復帰セレクタ・フッター文言・CSS グリッドを追随させる。API・並び替えロジックは触らない。

**Tech Stack:** Angular / vitest / HTML5 DnD

## Global Constraints

- かんばんボードのハンドルは変更しない。
- フィルタ中は既存どおり並び替え無効（L-460 / L-472）。
- キーボード並び替え後のみフォーカス復帰。DnD は復帰しない。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| マークアップ | Modify: `frontend/src/app/backlog.html` |
| スタイル | Modify: `frontend/src/app/backlog.css` |
| フォーカス復帰 | Modify: `frontend/src/app/backlog.ts`（セレクタのみ） |
| テスト | Modify: `frontend/src/app/backlog.spec.ts` |

---

### Task 1: ハンドル削除・順位ボタン化・文言／CSS／フォーカス／テスト

**Files:**
- Modify: `frontend/src/app/backlog.html`
- Modify: `frontend/src/app/backlog.css`
- Modify: `frontend/src/app/backlog.ts`（`focusHandleAfterRender` のセレクタ）
- Test: `frontend/src/app/backlog.spec.ts`

**Interfaces:**
- Consumes: 既存 `onHandleKeydown(event, cardIndex)`、`canReorder()`、`formatItemNumber`
- Produces: 操作要素は `.backlog-rank`（`<button type="button">`）。`.backlog-drag-handle` は DOM から消える

- [x] **Step 1: 失敗する／更新するテストを書く**

`backlog.spec.ts` の `.backlog-drag-handle` 参照を `.backlog-rank` に置換する。追加・更新する期待:

```ts
// グリフ無し
expect(f.nativeElement.textContent).not.toContain('⋮⋮');
expect(f.nativeElement.querySelector('.backlog-drag-handle')).toBeNull();

// 順位がボタンでキーボード並び替え
const ranks = Array.from(
  f.nativeElement.querySelectorAll('.backlog-rank') as NodeListOf<HTMLButtonElement>,
);
expect(ranks[2].tagName).toBe('BUTTON');
ranks[2].focus();
ranks[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
// …既存どおり reorderBacklog が呼ばれる

// フッター
expect(f.nativeElement.querySelector('.backlog-footer')?.textContent).toContain('行をドラッグ');
expect(f.nativeElement.querySelector('.backlog-footer')?.textContent).not.toContain('ハンドル');
```

単件時 `aria-disabled` も `.backlog-rank` で検証する。

- [x] **Step 2: テストを実行し、セレクタ／文言まわりが落ちることを確認**

```bash
cd frontend && npx vitest run src/app/backlog.spec.ts
```

- [x] **Step 3: HTML を更新**

`backlog.html` のハンドル `<button class="backlog-drag-handle">⋮⋮</button>` を削除し、順位を次のようにする:

```html
<button
  type="button"
  class="backlog-rank"
  [attr.aria-label]="
    formatItemNumber(card.number) + ' を移動（ドラッグまたは上下矢印キー）'
  "
  [attr.aria-disabled]="!canReorder() || reordering() ? 'true' : null"
  (keydown)="onHandleKeydown($event, i)"
>
  {{ i + 1 }}
</button>
```

（旧 `<span class="backlog-rank" aria-hidden="true">` は削除。）

フッター:

```html
行をドラッグ、または上下キーで優先順位を変えられます。
```

- [x] **Step 4: CSS を更新**

- `.backlog-drag-zone` の `grid-template-columns` から先頭のハンドル `auto` を削除（5 列: rank / number / title / status / detail）。
- `.backlog-drag-handle` ルールを削除し、`.backlog-rank` にボタン用スタイル（border:none、背景透明、min 24px、cursor:grab、aria-disabled 時 opacity）を足す。見た目の数字スタイル（font-size / weight / muted）は維持。
- `@media (max-width: 780px)` でもハンドル列を外す。`grid-template-columns` を `auto minmax(0, 1fr) auto`（rank / title+status / detail）にし、areas から `handle` を外す:

```css
.backlog-drag-zone {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'rank title detail'
    'rank status detail';
}
```

- [x] **Step 5: フォーカス復帰セレクタを更新**

`backlog.ts` の `focusHandleAfterRender` 内:

```ts
container.querySelectorAll<HTMLButtonElement>('.backlog-rank'),
```

メソッド名はそのままでよい（リネームは任意・範囲外でも可）。

- [x] **Step 6: テストを通す**

```bash
cd frontend && npx vitest run src/app/backlog.spec.ts
```

- [x] **Step 7: プロジェクト検証**

`package.json` / `frontend/package.json` の test・lint・build のうち存在するコマンドを実行し、通るまで直す。**コミットしない。**

---

## 手動確認

1. `/backlog` で `⋮⋮` が無い。
2. 行をドラッグして並びが変わる。
3. Tab で順位ボタンへ行き ↑↓ で並ぶ。フォーカスが移動先に残る。
4. フィルタ ON 時はドラッグ不可・順位 `aria-disabled`。
5. かんばんのハンドルは従来どおり。
6. 幅 780px 以下でも左端に空列が無く、順位→タイトル／ステータス→詳細の並びになる。

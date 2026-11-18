# 説明ブロックのプレースホルダー削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** 詳細の説明ブロックから placeholder を消し、空行（空ブロック）にもヒントが出ないようにする。

**Architecture:** `DescriptionBlocksEditor` の各 `textarea` から固定 `placeholder` 属性を削除するだけの FE 変更。ブロック分割・シリアライズ・autosave は触らない。作成モーダルは対象外。

**Tech Stack:** Angular / Vitest（既存 `description-blocks-editor.spec.ts`）

**Spec:** `docs/superpowers/specs/2026-11-18-description-placeholder-design.md`

## Global Constraints

- 詳細ブロック editor のみ。board / backlog 作成モーダルの placeholder は変更しない
- API / DB / `description` シリアライズ変更なし
- 既存 `aria-label` は維持（L-554）
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `frontend/src/app/description-blocks-editor.html` | placeholder 属性を削除 |
| `frontend/src/app/description-blocks-editor.spec.ts` | placeholder 非表示を固定するテスト |
| `frontend/src/app/description-blocks-editor.css` | （任意）未使用 `::placeholder` セレクタ削除 |

## 関連知見

- L-554: placeholder 削除後も aria-label を残す

---

### Task 1: 失敗するテストを先に書く

**Files:**
- Modify: `frontend/src/app/description-blocks-editor.spec.ts`

- [x] **Step 1: 空説明マウント時に placeholder が無く aria-label があるテストを追加**

```ts
it('does not set placeholder on empty description blocks', () => {
  const { f } = mount('');
  const list = [...areas(f)];
  expect(list.length).toBe(1);
  expect(list[0]!.placeholder).toBe('');
  expect(list[0]!.getAttribute('placeholder')).toBeNull();
  expect(list[0]!.getAttribute('aria-label')).toBe('説明ブロック 1');
});
```

- [x] **Step 2: Enter 後の空ブロックにも placeholder が無く aria-label があるテストを追加**

```ts
it('does not set placeholder on empty blocks created by Enter', () => {
  const { f } = mount('a');
  const area = areas(f)[0]!;
  area.setSelectionRange(1, 1);
  area.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  f.detectChanges();
  const list = [...areas(f)];
  expect(list.length).toBe(2);
  for (const [i, el] of list.entries()) {
    expect(el.placeholder).toBe('');
    expect(el.getAttribute('placeholder')).toBeNull();
    expect(el.getAttribute('aria-label')).toBe(`説明ブロック ${i + 1}`);
  }
});
```

- [x] **Step 3: テストを実行し、現状は失敗することを確認**

Run: `cd frontend && npm test -- --watch=false --include=src/app/description-blocks-editor.spec.ts`

Expected: 新テストが FAIL（現状は `placeholder="背景、取り組む内容、完了の条件など"`）

---

### Task 2: placeholder を削除してテストを通す

**Files:**
- Modify: `frontend/src/app/description-blocks-editor.html`
- Modify: `frontend/src/app/description-blocks-editor.css`（任意）

- [x] **Step 1: HTML から `placeholder="背景、取り組む内容、完了の条件など"` 行を削除**

`aria-label` バインディングは残す。

- [x] **Step 2:（任意）`.block-input::placeholder` だけのルールがあれば削除**

- [x] **Step 3: テストを再実行して PASS を確認**

Run: `cd frontend && npm test -- --watch=false --include=src/app/description-blocks-editor.spec.ts`

- [x] **Step 4: 作成モーダルの説明 placeholder が残っていることを確認**

Run: `rg 'タスクの背景や、完了の条件など' frontend/src/app/board.html frontend/src/app/backlog.html`

Expected: board / backlog の作成説明 textarea に当該文言が残っている（タイトル用 placeholder だけでは足りない）

- [x] **Step 5: コミットしない**（`/feature`）

---

## 検証まとめ

```bash
cd frontend && npm test -- --watch=false --include=src/app/description-blocks-editor.spec.ts
```

受け入れ: 詳細の空ブロックに案内文言が出ない／Enter 後も出ない／作成モーダルは従来どおり／aria-label 維持。

# 説明画像→コメント DnD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (preferred) or superpowers:executing-plans. Steps use TDD. **`/feature` 中はコミットしない**（コミットは後続 `/commit-ja`）。

**Goal:** 説明プレビューの添付画像をコメント下書き／編集へ DnD し、同じ `attachmentId` のマークアップを参照コピーで挿入する（再アップロードなし）。

**Architecture:** FE only。`attachment-dnd.ts` に MIME／encode／decode／所属検証。`DescriptionRichText` が dragstart。`ItemComments` が types 基準で参照ドロップ（下書きは既存ファイル DnD と共存、編集は参照のみ）。

**Tech Stack:** Angular 21、既存 `buildAttachmentMarkup`／`insertMarkupAt`、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-21-description-image-to-comment-dnd-design.md`

**知見:** L-001, L-044, L-408, L-653（L-830 は適用外）

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/app/attachment-dnd.ts` | MIME 定数・payload 型・encode／decode／belongsToItem |
| `frontend/src/app/attachment-dnd.spec.ts` | 純粋関数テスト |
| `frontend/src/app/description-rich-text.ts` | `draggableImages` 入力・img dragstart |
| `frontend/src/app/description-rich-text.spec.ts` | （無ければ追加）dragstart MIME |
| `frontend/src/app/description-blocks-editor.html` | プレビューに `[draggableImages]="attachmentField() === 'description'"` |
| `frontend/src/app/item-comments.ts` / `.html` | 下書き・編集の参照ドロップ、編集側 dragover/drop |
| `frontend/src/app/item-comments.spec.ts` | 参照 DnD／壊れた MIME／item 不一致／ファイル回帰 |

---

### Task 1: `attachment-dnd` 純粋モジュール

**Files:**
- Create: `frontend/src/app/attachment-dnd.ts`
- Create: `frontend/src/app/attachment-dnd.spec.ts`

- [x] **Step 1: 失敗するテストを書く**

```ts
import {
  SCRUM_ATTACHMENT_MIME,
  encodeAttachmentDragPayload,
  decodeAttachmentDragPayload,
  attachmentDragBelongsToItem,
} from './attachment-dnd';

it('encodes and decodes round-trip', () => {
  const raw = encodeAttachmentDragPayload({ itemNumber: 7, attachmentId: 3, alt: 'a' });
  expect(decodeAttachmentDragPayload(raw)).toEqual({ itemNumber: 7, attachmentId: 3, alt: 'a' });
});

it('rejects bad json / non-positive ids / wrong item', () => {
  expect(decodeAttachmentDragPayload('')).toBeNull();
  expect(decodeAttachmentDragPayload('{')).toBeNull();
  expect(attachmentDragBelongsToItem({ itemNumber: 1, attachmentId: 2, alt: 'x' }, 9)).toBe(false);
  expect(attachmentDragBelongsToItem({ itemNumber: 9, attachmentId: 0, alt: 'x' }, 9)).toBe(false);
  expect(attachmentDragBelongsToItem({ itemNumber: 9, attachmentId: 2, alt: 'x' }, 9)).toBe(true);
});

it('exports MIME constant', () => {
  expect(SCRUM_ATTACHMENT_MIME).toBe('application/x-scrum-attachment');
});
```

- [x] **Step 2: テストを走らせて失敗を確認**

Run: `cd frontend && npx vitest run src/app/attachment-dnd.spec.ts`  
Expected: FAIL（モジュール無し）

- [x] **Step 3: 最小実装**

```ts
export const SCRUM_ATTACHMENT_MIME = 'application/x-scrum-attachment';

export type AttachmentDragPayload = {
  itemNumber: number;
  attachmentId: number;
  alt: string;
};

export function encodeAttachmentDragPayload(p: AttachmentDragPayload): string {
  return JSON.stringify({
    itemNumber: p.itemNumber,
    attachmentId: p.attachmentId,
    alt: p.alt ?? '',
  });
}

export function decodeAttachmentDragPayload(raw: string): AttachmentDragPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AttachmentDragPayload>;
    const itemNumber = Number(v.itemNumber);
    const attachmentId = Number(v.attachmentId);
    if (!Number.isInteger(itemNumber) || itemNumber <= 0) return null;
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) return null;
    return { itemNumber, attachmentId, alt: typeof v.alt === 'string' ? v.alt : '' };
  } catch {
    return null;
  }
}

export function attachmentDragBelongsToItem(
  p: AttachmentDragPayload,
  currentItemNumber: number,
): boolean {
  return p.itemNumber === currentItemNumber && p.attachmentId > 0;
}

/** types にカスタム MIME が含まれるか（getData の空／非空は問わない）。 */
export function dataTransferHasAttachmentMime(types: readonly string[] | DOMStringList): boolean {
  return Array.from(types as ArrayLike<string>).includes(SCRUM_ATTACHMENT_MIME);
}
```

- [x] **Step 4: テスト成功を確認**

Run: `cd frontend && npx vitest run src/app/attachment-dnd.spec.ts`  
Expected: PASS

---

### Task 2: DescriptionRichText をドラッグソースに

**Files:**
- Modify: `frontend/src/app/description-rich-text.ts`
- Create or modify: `frontend/src/app/description-rich-text.spec.ts`
- Modify: `frontend/src/app/description-blocks-editor.html`

- [x] **Step 1: 失敗するテストを書く**

```ts
it('sets custom MIME on image dragstart when draggableImages', () => {
  // TestBed で text に同一 item の画像マークアップ、itemNumber=7, draggableImages=true
  // img で DragEvent('dragstart')、dataTransfer.setData を spy
  // expect setData(SCRUM_ATTACHMENT_MIME, encode…({ itemNumber:7, attachmentId, alt }))
});

it('does not set MIME when draggableImages is false', () => { /* … */ });

it('delete button is not draggable', () => {
  // canDelete=true の削除 button に draggable 属性が無い／false
});
```

- [x] **Step 2: 失敗確認**

Run: `cd frontend && npx vitest run src/app/description-rich-text.spec.ts`  
Expected: FAIL

- [x] **Step 3: 実装**
  - `draggableImages = input(false)`
  - image の `<img>` に `[attr.draggable]="draggableImages() ? 'true' : null"` と `(dragstart)="onDragStart(seg, $event)"`
  - 削除ボタンは `draggable` を付けない（クリック／削除は既存のまま）
  - `onDragStart`: `draggableImages()` でなければ return。`encodeAttachmentDragPayload({ itemNumber: itemNumber(), attachmentId: seg.attachmentId, alt: seg.alt })` を `setData(SCRUM_ATTACHMENT_MIME, …)`。`effectAllowed = 'copy'`。
  - blocks-editor プレビュー: `[draggableImages]="attachmentField() === 'description'"`（solution は false）

- [x] **Step 4: テスト成功**

Run: `cd frontend && npx vitest run src/app/description-rich-text.spec.ts`  
Expected: PASS

---

### Task 3: ItemComments 参照ドロップ

**Files:**
- Modify: `frontend/src/app/item-comments.ts`
- Modify: `frontend/src/app/item-comments.html`
- Modify: `frontend/src/app/item-comments.spec.ts`

- [x] **Step 1: 失敗テスト**
  - 下書き: types に MIME・正しい payload → draftBody に markup、`uploadAttachment` 非呼出
  - 下書き: types に MIME・壊れた／空 getData → actionError、本文不変、upload 非呼出
  - 下書き: types に MIME・他 itemNumber → 同上
  - 下書き: types に MIME 無し・file あり → 既存 upload 回帰（mock）
  - 下書き: 本文が上限近くで参照挿入 → 文字数エラー・本文不変（L-001）
  - 下書き: `readOnly=true` で drop → preventDefault されない／本文不変／エラー無し
  - 下書き: 二重 drop（insertGuard）→ マークアップは 1 回分だけ（L-653）
  - 編集中: 正しい payload・textarea selection あり → その位置に挿入、upload 非呼出
  - 編集中: selection 無し → 末尾挿入
  - 編集中: file のみ → upload 非呼出（参照専用）
  - 編集中: 壊れた MIME／他 itemNumber／文字数超過 → 本文不変＋エラー、upload 非呼出（L-001/L-044）
  - 編集中: 二重 drop → 1 回分だけ（L-653）
  - 回帰: `confirmAttachmentDelete` の `detail>1`／`event.repeat` 抑止を変更していない（L-408。新確認ダイアログも足さない）

- [x] **Step 2: 失敗確認**

Run: `cd frontend && npx vitest run src/app/item-comments.spec.ts`  
Expected: FAIL

- [x] **Step 3: 実装（シグネチャ固定）**

```ts
// item-comments.ts — 共有経路（下書き・編集の両方から呼ぶ）
private tryInsertAttachmentRefFromDataTransfer(
  dt: DataTransfer,
  target: 'draft' | 'edit',
): void {
  // 1. dataTransferHasAttachmentMime(dt.types) でなければ:
  //    target==='draft' なら既存 file upload、edit なら return
  // 2. decodeAttachmentDragPayload(dt.getData(SCRUM_ATTACHMENT_MIME))
  // 3. null または !attachmentDragBelongsToItem(p, this.number) → actionError、return
  // 4. markup = buildAttachmentMarkup(this.number, p.attachmentId, p.alt)
  // 5. insertMarkupAt(text, start, end, markup, COMMENT_BODY_MAX)
  //    null → 文字数エラー。成功 → draftBody / editBody 更新
}
```

  - `onDraftDragOver` / `onDraftDrop`: `readOnly` なら即 return（preventDefault しない）。drop では上記を呼ぶ。
  - 編集 UI に `(dragover)` / `(drop)`。`readOnly` 同様。編集は参照のみ（files 無視）。
  - 挿入位置: 下書き＝末尾（`length,length`）。編集＝`#editBody` textarea の selection（無ければ末尾）。
  - 同期 `insertGuard`（ガード中は 2 回目 no-op）。`confirmAttachmentDelete` は触らない（L-408）。
  - エラー文言例: 「画像の参照を挿入できませんでした。」／文字数は既存コメント上限文言。

- [x] **Step 4: 関連 FE テスト一括**

Run: `cd frontend && npx vitest run src/app/attachment-dnd.spec.ts src/app/description-rich-text.spec.ts src/app/item-comments.spec.ts src/app/description-blocks-editor.spec.ts`  
Expected: PASS

- [x] **Step 5: DELETE 契約の回帰（受け入れ 7）**  
  既存 `attachment_handler_test`／FE delete テストは触らない。手動または既存 DELETE テストが「同一 id のマークアップが複数本文にあっても strip」を既にカバーしていることを確認し、プラン記録に「既存テストで維持」と書く。新規 BE は不要。

---

## 手動確認（任意）

1. 説明に画像があるカードで、プレビュー画像をコメント下書きへ DnD → マークアップ挿入・再 upload 無し。
2. 編集中コメントへ同様。
3. ファイル DnD は下書きで従来どおり。

## サブエージェントレビュー

- 第 1 周（要件との対応）: readOnly・文字数超過・編集キャレット・削除非破壊・DELETE 維持・Task2 具体化・insertGuard テスト不足 → 反映済み。
- 第 2 周（タスク整合・知見）: 編集側の失敗／連打テスト、L-408 非改変、decode／belongsToItem 配線固定 → 反映済み。

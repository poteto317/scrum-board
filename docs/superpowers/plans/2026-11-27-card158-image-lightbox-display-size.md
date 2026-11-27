# 画像の拡大表示と表示サイズ（#158）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 説明・ソリューション・コメントの添付画像をクリックで拡大し、本文 markdown の title で小・中・大の表示サイズを永続化する。

**Architecture:** parse/build に CommonMark title（`sm`/`md`/`lg`）を足す。表示・lightbox・サイズ UI は `DescriptionRichText`。親が `attachmentId` 全出現を同じ size に書き換えて既存保存経路へ載せる。

**Tech Stack:** Angular standalone、既存 `dialog.modal-backdrop`、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-27-card158-image-lightbox-display-size-design.md`

## Global Constraints

- title 無し・未知 = `md`。path と `"title"` の間は空白必須。
- `canChangeImageSize`: 説明・ソリューションは `canDelete`（`imagesEnabled()`）と同じ。コメントは `canModifyComment(c)`。
- 同一 attachmentId はフィールド内すべて同サイズ。
- lightbox は × / Escape で閉じ、backdrop では閉じない。
- feature ではコミットしない。

## File map

| File | Responsibility |
|--|--|
| `description-link.ts` (+spec) | size 正規化・parse/build |
| `description-rich-text.ts` (+spec) | class・サイズ UI・dialog・click |
| `description-blocks-editor.ts` (+spec) | size 変更 → textChange |
| `item-comments.ts` (+html/spec) | size 変更 → コメント本文更新 |
| helper（任意） | `setAttachmentImageDisplaySize(text, itemNumber, id, size)` 純関数 |

---

### Task 1: parse / build / rewrite 純関数（RED→GREEN）

- [ ] `ImageDisplaySize = 'sm'|'md'|'lg'`、`normalizeImageDisplaySize`、`buildAttachmentMarkup(..., size?)`、parse が title を読む、`setAttachmentImageDisplaySize` が当該 id の全 `![…](path…)` を書き換え。
- [ ] **L-018:** rewrite は必ず `normalizeImageDisplaySize` 済みの値を `buildAttachmentMarkup` に渡す（手書きで `"lg"` を連結しない）。未知は md（title 省略）。
- [ ] テスト: 無し→md、`"lg"`、未知→md、空白無し title は非画像にしない、全出現書き換え、md で title 省略。
- [ ] `npx ng test --watch=false --include=src/app/description-link.spec.ts` GREEN。

### Task 2: DescriptionRichText UI + lightbox

- [ ] CSS 値を仕様どおり固定: `--sm` → `max-width: min(100%, 12rem)`、`--md` → `min(100%, 28rem)`、`--lg` → `min(100%, 48rem)`。
- [ ] img click → dialog。開いたら × へフォーカス。閉じたら元の img（または操作していたサイズボタン）へフォーカスを戻す。
- [ ] × / Escape で閉じる。**backdrop click では閉じない**（テストで明示）。
- [ ] サイズ group（`canChangeImageSize`）、`imageDisplaySize` output、delete/size は stopPropagation。
- [ ] テスト: class と max-width 契約、open/close+フォーカス、backdrop 非クローズ、size emit、delete で dialog 開かない、`canChangeImageSize=false` でサイズ UI 無し・lightbox 可、既存 bookmark/file 回帰。
- [ ] GREEN: `description-rich-text.spec.ts`。

### Task 3: 親配線

- [ ] blocks-editor: `[canChangeImageSize]="imagesEnabled()"`（`[canDelete]` と同一）。size → `setAttachmentImageDisplaySize` → `textChange`。
- [ ] comments: 閲覧中 `[canChangeImageSize]="canModifyComment(c)"`。size → rewrite 本文 → **既存コメント更新 API で即保存**（楽観更新）。編集モード（textarea）中はサイズ UI 無し・変更しない。
- [ ] **L-060:** blocks-editor と item-comments の両方で、`(imageDisplaySize)` / `[canChangeImageSize]` 配線を外すと落ちるテストを置く（rich-text 単体 emit だけでは不可）。
- [ ] GREEN: 関連 spec。

### Task 4: 検証（コミットしない）

- [ ] 関連 ng test + `npm run test:css-contract`（dialog 契約を壊していないこと）。
- [ ] `git status` 確認。コミットしない。

## 知見

- [ ] L-060 / L-018 / dialog[open] flex

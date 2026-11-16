# コピー結果バナー Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-11-16-copy-feedback-banner-design.md`  
> **コミットしない**（`/feature`）。知見: L-037, L-040, L-039

**Goal:** リンク／コマンドコピーの結果を、ボードと詳細で共通の上部中央メッセージカード（緑/赤＋アイコン、約3秒で消去）として目立たせる。

**Architecture:** `LatestCopyFeedback` に kind を追加しタイマーを 3s に。共有バナーコンポーネントをボード・詳細に配置し、旧インライン／sr-only 表示を置き換える。

**Tech Stack:** Angular 21 / vitest

## Global Constraints

- 文言定数は変更しない。
- 二重表示しない。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| 状態 | `latest-copy-feedback.ts`, `copy-feedback-state.ts`, link/command feedback |
| UI | Create: `copy-feedback-banner.ts` (+ html/css または inline) |
| 配置 | `board.html`/`board.ts`, `item-detail.html`/`item-detail.ts` |
| スタイル変数 | `styles.css`（成功／失敗色） |
| テスト | 既存 `*.spec.ts` + banner / latest 更新 |

---

### Task 1: Latest + State に kind と 3s タイマー

- [x] `CopyFeedbackKind = 'success' | 'failure'`
- [x] `LatestCopyFeedback`: `message` + `kind` signals、`publish(message, kind)`、クリアで両方空、タイマー **3000ms**
- [x] `CopyFeedbackState.show(message, kind)` → latest.publish
- [x] link/command の success/failure 呼び出しで kind を渡す
- [x] 単体テスト（後勝ち・3s 消去・kind）を vitest fake timers で更新

**Done when:** latest/state のテスト緑。

---

### Task 2: 共有バナーコンポーネント

- [x] `CopyFeedbackBanner`（inputs: message, kind）。空なら描画しない
- [x] `role="status"` + `aria-live="polite"`
- [x] 成功／失敗クラス＋アイコン（インライン SVG または CSS）。色は `:root` に `--feedback-ok-*` / `--feedback-error-*` を追加
- [x] fixed 上部中央の CSS（`z-index` で他 UI の上、`max-width` + 左右余白でモバイル収まり）
- [x] コンポーネントテスト（成功／失敗クラス、**アイコン表示**、空は非描画）

**Done when:** banner テスト緑（クラス＋アイコン＋空）。

---

### Task 3: ボード・詳細へ配線

- [x] board: sr-only `.copy-link-live` をバナーに置換。`copyFeedbackKind` を公開
- [x] detail: `.copy-link-feedback` をバナーに置換（二重なし）
- [x] board / item-detail のコピー関連 spec を更新し、**成功・失敗それぞれで kind クラスとアイコンを断言**

**Done when:** FE 該当テスト緑（ボード・詳細の kind＋アイコン含む）。

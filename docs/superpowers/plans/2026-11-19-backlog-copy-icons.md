# バックログ リンク／コマンドコピー Implementation Plan

> **本フローではコミットしない**（`/feature`）。

**Goal:** バックログ各行にボードと同型のリンク／コマンドコピーを載せ、結果バナーも出す。

**Architecture:** `backlog.ts` にボードのコピー／コマンドメニュー経路を移植。UI は行 grid に quick-actions 列。CSS は `backlog.css` に同型規則（board 非変更）。

**Spec:** `docs/superpowers/specs/2026-11-19-backlog-copy-icons-design.md`

**Tech Stack:** Angular / Vitest、既存 Copy* helpers

## Global Constraints

- API／DB 変更なし、ボード挙動・board.css 変更なし
- L-037 / L-040（メニュー）/ L-879 / LatestCopyFeedback
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `backlog.ts` / `backlog.html` / `backlog.css` | 配線・UI・スタイル |
| `backlog.spec.ts` | テスト |
| 設計・プラン docs | 文書 |

---

### Task 1: バックログへコピー UI と挙動

**Files:** `backlog.ts`, `backlog.html`, `backlog.css`, `backlog.spec.ts`

- [x] **Step 1: 失敗するテスト**
  - 行にコマンド／リンクボタン（a11y: haspopup/expanded/menu/menuitem）
  - リンクコピーでバナー成功
  - コマンド: 1 件自動コピー、複数メニュー、再クリックで閉じる（L-879）、外側クリック・Esc・`.backlog-scroll` scroll で閉じる
  - `commandMenuLoadGeneration`（`backlogLoadGeneration` とは別）で古い一覧を捨てる
  - `load`／プロジェクト切替でメニュー閉じ
  - コピー UI から DnD が始まらない（drag-zone 外 or preventDefault）

- [x] **Step 2: 実装**
  - HTML: status と detail の間に quick-actions（コマンド→リンク）。quick-actions は `.backlog-drag-zone` の外（行の兄弟）推奨
  - CSS: 6 列 grid。`backlog.css` にボード同型の copy スタイル（board.css は触らない）
  - TS: ボードの `toggleCommandMenu` 一式を移植（ClipboardItem・fixed 座標・`command-menu-open`）。HostListener（document click/Esc/window resize/scroll）＋ `#backlogScroll (scroll)`。`destroyRef` / `load` / 切替成功で `closeCommandMenu`。バナー配線
  - drag: `onItemDragStart` で copy セレクタ除外、または zone 外配置

- [x] **Step 3: `npx ng test --watch=false --include='**/backlog.spec.ts'` PASS**

- [x] **Step 4: コミットしない**

---

## プランレビュー

### 第1・2周（要件／整合）

対応: 切替・破棄・scroll テンプレート、6 列 DOM、別 generation、L-879 トグル、drag-zone 外を Step に明記。

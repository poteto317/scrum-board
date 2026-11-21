# Sticky App Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.  
> **Spec:** `docs/superpowers/specs/2026-11-18-sticky-app-header-design.md`  
> **コミットしない**（`/feature`）。

**Goal:** document 縦スクロール中も `.app-header` がビューポート上端に残る。

**Architecture:** CSS `position: sticky` on shell header only. No HTML/TS behavior change.

**Tech Stack:** Angular / vitest / CSS

## Global Constraints

- サイドバー・列見出しは sticky にしない（本件の L-015＝シェル以外に固定 UI を複製しない。他文書の PATCH 意味とは別）
- `z-index: 5`（メニュー最大 6 より下；dialog top layer より下）
- 影を足さない；`background: var(--paper)` は既存のまま維持
- 祖先に sticky を壊す `overflow` を新たに足さない
- `/feature` 中はコミットしない

## 知見チェック

| ID | Plan での扱い |
|----|----------------|
| L-015 | シェル1箇所のみ。ボード等に sticky ヘッダーを複製しない |
| L-842 | Task1 GREEN で `app.spec.ts` ＋ `project-session.spec.ts` の切替 busy を回帰 |

## ファイルマップ

| 領域 | パス |
|------|------|
| CSS | Modify: `frontend/src/app/app.css` |
| テスト | Modify: `frontend/src/app/app.spec.ts` |

---

### Task 1: sticky CSS と回帰テスト

**Files:** `app.css` / `app.spec.ts`

- [x] **Step 1: 失敗するテスト** — `.app-header` の computed style: `position === 'sticky'`、`top === '0px'`、`zIndex === '5'`（文字列）
- [x] **Step 2: RED** — `npx ng test --watch=false --include='**/app.spec.ts'`
- [x] **Step 3: 実装** — `.app-header { position: sticky; top: 0; z-index: 5; }`（既存 background はそのまま）
- [x] **Step 4: GREEN** — app.spec ＋ project-session.spec（19 passed）

---

### Task 2: 手動確認

- [ ] document 縦スクロール（ボード／詳細）でヘッダー残存（PR 前に確認可）
- [ ] モーダル前面；プロジェクト切替・ナビ・ブランドリンク
- [ ] 列見出し非固定；コマンドメニューがヘッダーより上で操作可能
- [ ] バックログ内側スクロールのみはスコープ外

## サブエージェントのレビュー済み

- 第 1 周（要件対応）: 手動チェック拡充・background 維持・overflow 制約を追記
- 第 2 周（整合と知見）: L-015 別義・L-842 の project-session 回帰・zIndex 文字列を明記

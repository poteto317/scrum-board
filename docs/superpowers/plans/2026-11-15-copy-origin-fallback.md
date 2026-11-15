# コピー origin フォールバック Implementation Plan

> **For agentic workers:** `/feature` 中はコミットしない。

**Goal:** `public-config` 通信失敗時もリンク／`{{url}}` コピーが `location.origin` で動くようにする。

**Spec:** `docs/superpowers/specs/2026-11-15-copy-origin-fallback-design.md`

## Task 1: AppOrigin

- [x] 失敗時は `ok: false` にせず、空 config と同様に `location.origin` を返す
- [x] 失敗後はキャッシュを残さず、次回 `resolve` で再取得
- [x] 成功・空・失敗のユニットテストを更新
- [x] `board` / `card-detail` の `failOrigin` 分岐を外す（常に origin を渡す）

## Task 2: 検証

- [x] `ng test`（app-origin / 関連）
- [x] 設計の受け入れ条件を照合

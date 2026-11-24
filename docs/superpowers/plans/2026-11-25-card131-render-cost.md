# カード131 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 不要なカード高さ計測とリッチテキスト解析を減らす。
**Architecture:** 既存の計測予約に有効条件を追加し、Map同値比較をsignalに指定する。解析はcomputedにする。
**Tech Stack:** Angular 21 / TypeScript / Vitest / jsdom
**Spec:** docs/superpowers/specs/2026-11-25-card131-render-cost-design.md

## Global Constraints
依存追加なし。表示・添付画像操作・API・保存形式を維持する。pack→free用の上端計測は維持する。feature段階ではコミットしない。

## Review Focus
予約後にpackへ切り替わった場合はDOMを読まない。
モバイルからデスクトップのfreeへ復帰した場合に計測する。
同件数でもID交換・高さ変更なら更新し、同値なら参照を保持する。
全カード削除では空Mapへ更新する。
本文と番号の変更は解析を更新し、それ以外の入力変更では解析しない。

## Task 1: 高さ計測の条件と更新抑止（独立した責務）
Files: frontend/src/app/board-layout-measure.ts, board.ts, board-layout-measure.spec.ts, board-free-layout.spec.ts または専用のboard-height-measure.spec.ts。
Interfaces: ScheduleCardHeightMeasureDeps に isEnabled: () => boolean を追加。sameCardHeights(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean をexportし、Board.cardHeightsのequalへ接続。
- [x] 予約前/予約後pack、破棄時はquerySelectorAll/getBoundingClientRect未実行、freeでは高さが反映される回帰テストを追加する。
- [x] Map比較の同値（順番違い含む）/高さ変更/ID交換/空Mapを確認。Boardの実シグナルで同値更新後の参照保持も確認する。
- [x] モバイル→デスクトップfreeの復帰で再計測するテストを追加する。pack復帰では計測しない。
- [x] `cd frontend && npm test -- --watch=false --include='src/app/board*measure*.spec.ts'` で変更前の失敗を確認する。
- [x] 予約前とcallback先頭でisEnabledを評価する。BoardはisFreeLayoutを渡し、Mapのequalを指定する。既存media queryのchange処理でデスクトップfreeへ戻った場合の予約を追加する。
- [x] 関連テストを実行しPASSを確認する。L-040（実行時再確認）、L-285（寸法スタブ）、L-289（後始末）、L-519（同値参照）を守る。

## Task 2: リンク解析のキャッシュ（独立した責務）
Files: frontend/src/app/description-rich-text.ts, description-rich-text.spec.ts。
Interfaces: segmentsをreadonly computedにする。テンプレート呼び出しと戻り値の型は同じ。
- [x] 初期描画後の再検知・canDelete/draggableImages変更でsegments配列の参照を維持し、text/itemNumber変更で新しい解析結果と表示更新を確認するテストを追加する。ESM exportは再定義できないためspyではなく実際の解析結果の参照で確認する。
- [x] `cd frontend && npm test -- --watch=false --include=src/app/description-rich-text.spec.ts` で失敗を確認する。
- [x] computedをimportし、segmentsをcomputed(() => parseDescriptionLinks(this.text(), this.itemNumber()))へ変更する。
- [x] 同コマンドでPASSを確認する。

## Task 3: 全体検証
- [x] `cd frontend && npm test -- --watch=false` を実行する。
- [x] `cd frontend && npm run build` を実行する（型/テンプレートチェック含む）。
- [x] レビューゲートを通しfeature完了後、refactor-srpへ自動連結する。

後続のコミットではTask1とTask2を各テスト込みで分離し、設計/計画は別責務にする。

# AI チャット: キー未設定・残量なしの挙動 — 設計

- カード: [#52 AIチャット: キー未設定・残量なしのときの挙動を実装する](https://scrum-board-jkcejsb6ka-an.a.run.app/items/52?project=1)
- 前提: [#47 MVP](./2026-11-21-ai-chat-mvp-design.md) / [#51 上限・残量 API](./2026-11-21-ai-credits-limit-design.md)（`GET /api/ai/credits`・429 `ai_credit_limit`）/ PR #71（キー未設定の settings 案内・503 `ai_not_configured`）
- 日付: 2026-11-21

## 背景

- カード完了条件: 使えない状態で AI 呼び出し（課金）が起きないこと、画面文言と a11y が既存エラー表示と揃うこと。
- 進捗メモ: キー未設定案内は settings（PR #71）済み。残量なし UI は #51 依存で後続だった。#51 は Done。
- 現状ギャップ: AI パネルは送信後のエラー表示のみ。`configured=false`／残量ゼロの**事前**無効化と設定への案内、低残量警告が無い。FE に `GET /api/ai/credits` クライアントが無い。

## 決めたこと（推奨案を採用）

| 項目 | 決定 |
| --- | --- |
| スコープ | **フロント中心**。パネルが `GET /api/ai/credits` を読み、状態に応じて入口を無効化／警告する。BE の拒否（503／429）は #51・既存を前提に回帰確認のみ。`/settings` の残量 UI は **#54**（本カードでは触らない） |
| 残量ゼロの API code | 既存の **`ai_credit_limit`**（429）。`ai_credit_exhausted` へのリネームはしない |
| 低残量しきい値 | 上限ありかつ `remainingTokens > 0` かつ `remainingTokens < limitTokens * 0.1` のとき警告。`unlimited` または未設定（`limitTokens` null）は警告なし。**`composeBlocked` 中は低残量 `status` を出さない**（blocked バナーのみ） |
| 低残量 UI | パネル内の**非ブロッキング**警告（`role="status"`）。送信は可能 |
| 状態の優先 | `configured === false` を最優先の alert とする。キー未設定かつ残量ゼロでも未設定文言のみ（残量ゼロ文言は出さない） |
| キー未設定 UI | `configured === false` のとき入力・送信を無効化し、設定ページ（`/settings`）への案内を出す（`role="alert"`）。履歴の閲覧・クリアは可 |
| 残量ゼロ UI | `configured === true` かつ `unlimited === false` かつ（`remainingTokens === 0` **または** `remainingTokens == null`）のとき入力・送信を無効化（欠落は fail-closed）。理由＋設定への案内（`role="alert"`）。履歴の閲覧・クリアは可 |
| データ源 | パネル表示時に **`GET /api/ai/credits` のみ**（`configured` もここに含まれる）。`GET /api/ai/usage` は二重取得しない |
| credits 読込中 | 履歴の loading と同様、credits 取得完了まで入力・送信は **disabled**（誤送信防止）。完了後に状態を適用 |
| credits 失敗 | 取得失敗時は **blocked なし**（直前の成功結果も捨てる）。送信は従来どおり可能にし、サーバ 503／429 に任せる。専用バナーは出さない |
| 世代（L-037） | `number`／`projectId`／`itemId` 変更で generation を進め、古い credits 応答は破棄する（履歴と同様） |
| 送信時エラー | 既存どおりサーバ message を `role="alert"` で表示。429 `ai_credit_limit`／503 `ai_not_configured`／429 `ai_busy` を区別して文言を上書きしない（サーバ固定文を使う）。失敗時は下書きを残す（L-001） |
| 課金が起きないこと | 入口無効時は `POST .../ai-chat` を呼ばない。サーバ側は既存どおりセマフォ前に上限チェック。FE テストで無効時に POST が走らないことを固定 |

## 非目標

- `/settings` への残量・上限表示（#54）
- admin の上限編集 UI
- BE の code リネーム・新エンドポイント
- refined（AI 整形）パネルの同等 UX（本カードはチャット入口。サーバ拒否は既存）
- 低残量での送信ブロック
- 原子的クレジット予約（#51 既知制限のまま）

## 利用者体験

1. 編集可のアイテム詳細で AI パネルを開くと、履歴と並行して credits を取得する。
2. credits 読込中は入力・送信 disabled。
3. キー未設定: 警告＋「設定を開く」リンク。入力欄と送信は disabled。他機能は従来どおり。
4. 残量ゼロ（キー設定済み）: 上限到達の説明＋設定への案内。入力・送信 disabled。
5. 低残量（blocked でないときのみ）: status 警告。送信可。
6. 送信中にサーバが 429／503 を返したら、既存エラー枠に表示し draft を保持する。credits 取得失敗時は blocked を付けず送信可（サーバ拒否に任せる）。

## UI 文言（固定・確定）

| 状態 | role | 文言 |
| --- | --- | --- |
| キー未設定 | alert | `AI は未設定です。サーバーに ANTHROPIC_API_KEY を設定するとチャットと整形が使えます。` ＋ `/settings` へのリンク「設定を開く」（settings.html 既存文と同一） |
| 残量ゼロ | alert | `AI の利用上限に達しています。利用状況は設定で確認できます。` ＋「設定を開く」（上限編集 UI は #54） |
| 低残量 | status | `AI の残りトークンが少なくなっています（概算）。` |
| credits 読取失敗 | （専用バナーなし） | 送信時の既存エラー表示に任せる |

## フロント変更概要

- `Api.getAICredits()` → `AICredits` 型（OpenAPI `AICredits` に合わせ camelCase）
- `ItemAiChat`: credits 購読、`composeBlocked`（未設定 or 残量ゼロ）、`lowRemaining` 計算、テンプレートで disabled／バナー／`routerLink="/settings"`
- ユニットテスト: 各状態の disabled／POST 非呼び出し、低残量の境界（ちょうど 10% は警告なし、未満はあり）、credits 失敗でも送信可

## 受け入れ条件（#52）

1. `configured=false` でチャット入力・送信が無効、設定への案内があり、POST が走らない（テスト）
2. 残量ゼロ（configured）で同様に無効＋案内、POST が走らない（テスト）
3. 低残量（10% 未満・remaining>0・非 blocked）で status 警告が出るが送信可能（テスト）
4. credits 読込中は送信不可。credits 失敗後は送信可・blocked なし（テスト）
5. アイテム切替後に古い credits 応答が適用されない（L-037・テスト）
6. 送信失敗時（503／429）に既存どおり alert 表示・draft 保持（回帰）
7. `/settings` の残量 UI は変更しない（#54）
8. BE の `ai_credit_limit`／`ai_not_configured` 契約は変更しない

## 知見

- L-001（失敗を成功扱いしない・draft 保持）
- L-037（アイテム切替時の世代で古い credits／履歴を捨てる）
- L-976（応答フィールド意味を設計で固定）
- OpenAPI `AICredits` 正本

## レビュー記録

- 第1周（記述の確かさ）: blocked 時の低残量非表示・未設定優先・読込中 disabled・失敗時 unblock・文言を settings と同一・L-037 を決定表／AC に明記
- 第2周（範囲と知見）: 「低残量は範囲外」→ **対応不要**（カード本文が「残量が少ないときの警告」を含み、推奨しきい値を採用済み）。知見反映は十分
- 結果: 妨げ解消。設計確定

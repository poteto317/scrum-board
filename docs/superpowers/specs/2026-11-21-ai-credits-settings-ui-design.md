# AI クレジット設定 UI — 設計

- カード: [#54 AIチャット: 設定ページにAIクレジットの残量を表示する](https://scrum-board-jkcejsb6ka-an.a.run.app/items/54?project=1)
- 前提: [#51 上限・残量 API](./2026-11-21-ai-credits-limit-design.md) / [#52 不可状態 UI](./2026-11-21-ai-unavailable-states-design.md)（低残量 10%）/ `/settings` 既存利用状況
- 日付: 2026-11-21

## 背景

- 親要望: 残りどれくらいかを設定ページで分かるようにする。
- BE の `GET/PUT /api/ai/credits` は Done。`/settings` は累計 `GET /api/ai/usage` のみ（チャット側は #52 で `getAICredits` 済み）。

## 決めたこと（推奨案を採用）

| 項目 | 決定 |
| --- | --- |
| レイアウト | **「AIクレジット」セクションを新設**（残り／使用済み／上限／期間／概算注記）。既存「AI 利用状況」は残す |
| データ | credits は `GET /api/ai/credits`、利用状況は `GET /api/ai/usage` を**並列取得** |
| 編集 | **admin のみ**上限を入力・保存（`PUT /api/ai/credits`）。判定は `AuthSession.isAdmin()`。member は読み取りのみ（編集 UI 非表示） |
| unlimited UX | 「上限なし」チェックで解除（`limitTokens: null`）。オフのとき非負整数入力が必須 |
| 低残量 | #52 の `isLowRemaining(credits)` をそのまま再利用（`unlimited`／`limitTokens` null／`remainingTokens` null／blocked 時は false。境界は `remaining < limit * 0.1` かつ `remaining > 0`）。文言＋視覚強調（色だけに頼らない）。`role="status"` |
| 枯渇 | #52 の `blockedReason(credits)==='exhausted'`（`!unlimited` かつ `remainingTokens == null \|\| remainingTokens === 0`）。`configured===false` と同時なら**未設定のみ**（枯渇非表示。#52 と同じ優先） |
| キー未設定 | credits の `configured===false` で既存と同趣旨の案内（`<code>ANTHROPIC_API_KEY</code>` 付き） |
| 読込／失敗 | セクション単位で loading／`role="alert"`＋再読み込み。usage と credits は独立（片方失敗でも他方可） |
| 保存中 | 保存ボタン disabled・「保存中…」。成功で表示を PUT 応答で更新。失敗はサーバ message を alert、下書き値は残す（L-001） |
| 検証 | 負数・非整数・空（上限あり時）はクライアントで拒否。サーバ 400 もそのまま表示 |
| unlimited シリアライズ | 「上限なし」保存時、PUT ボディに **`limitTokens: null` を明示**（キー省略不可・L-909） |
| チャット枯渇文言 | #52 が本カードへ渡した約束どおり、`AI_EXHAUSTED_MESSAGE` を設定能力に合わせて更新（下表） |
| 本カード範囲 | **FE のみ**。OpenAPI／BE は変更しない |

## 非目標

- Anthropic 組織残高の取得
- member による上限編集
- API キーの UI 保存・編集（案内表示のみ。キー自体は環境変数）
- チャットパネル以外への残量ウィジェット追加
- 利用状況セクションの削除・統合

## 利用者体験

1. `/settings` を開くと利用状況とクレジットを並列で読む。
2. 全ログインユーザーが残量・使用・上限（または上限なし）・期間・概算注記を見る。
3. admin は上限を数値で設定、または「上限なし」で解除して保存する。
4. 低残量時は status で固定文言を出す。枯渇時は alert（未設定と同時なら未設定のみ）。送信停止は #52／BE。

## UI フィールド（クレジット）

| 表示 | ソース | 備考 |
| --- | --- | --- |
| 残り | `remainingTokens` | `unlimited===true` のとき表示は「上限なし」 |
| 使用済み | `usedTokens` | 概算 |
| 上限 | `limitTokens` | `unlimited===true` のとき「上限なし」 |
| 期間 | `period` | 表示は「累計」（`cumulative`） |
| 概算注記 | （固定文言） | `トークン数は概算です。Anthropic の請求と一致しない場合があります。` |
| 低残量 | #52 `isLowRemaining` で導出 | API フィールドではない |
| 枯渇 | #52 `blockedReason==='exhausted'` で導出 | API フィールドではない |

## UI 文言（設定ページ・固定）

| 状態 | role | 文言 |
| --- | --- | --- |
| キー未設定 | alert | settings 既存と同趣旨: `AI は未設定です。…`＋`<code>ANTHROPIC_API_KEY</code>`（既存文を流用） |
| 枯渇（admin） | alert | `AI の利用上限に達しています。下の上限を変更できます。` |
| 枯渇（member） | alert | `AI の利用上限に達しています。管理者に上限の変更を依頼してください。` |
| 低残量 | status | `AI の残りトークンが少なくなっています（概算）。`（#52 `AI_LOW_REMAINING_MESSAGE` と同一） |
| チャット枯渇（更新） | alert | `AI_EXHAUSTED_MESSAGE` を `AI の利用上限に達しています。設定で上限を確認・変更できます。` に更新（「設定を開く」リンクは既存どおり） |

## 受け入れ条件（#54）

1. 残量・使用・上限が `GET /api/ai/credits` の値と一致して表示される（テスト）
2. admin が上限設定／解除できる。member に編集 UI が無い。「上限なし」保存でリクエスト JSON に `limitTokens: null` が載る（テスト）
3. 読込中・失敗・キー未設定の表示がある
4. 低残量で文言による強調がある（色のみに依存しない）
5. 375px 相当でレイアウトが崩れない（グリッドが1列化または折り返し）
6. スクリーンリーダーで残量が読める（`dl`／明示ラベル）
7. `AI_EXHAUSTED_MESSAGE` が設定向け文言に更新されている（テスト）
8. BE／OpenAPI を変更しない

## 知見

- L-001（失敗時 draft 保持）, L-044, L-909（PUT null 解除）, L-976, L-978（`[attr.disabled]`）, L-980（remaining null fail-closed）, L-981
- L-037 は本カードでは**適用外**（settings は単一画面・item/project 切替なし）。credits/usage の再読込は明示ボタンまたは保存成功後の応答で足りる

## レビュー記録

- 第1周（記述の確かさ）: 11件 → 反映（FE 現状の限定、isAdmin、isLowRemaining/blockedReason 完全条件、未設定優先、文言固定、unlimited 表示「上限なし」、概算注記本文、導出列分離、枯渇 admin/member 分岐、L-037 適用外）
- 第2周（範囲と知見）: 3件 → 反映（キー UI 編集を非目標、チャット枯渇文言を範囲内で更新、AC2 に limitTokens:null ワイヤ）
- 自動承認: 推奨案採用済み・ブロッカーなし

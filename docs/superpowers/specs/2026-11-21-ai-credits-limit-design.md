# AI 利用上限・残量 API — 設計

- カード: [#51 AIチャット: AIの利用上限（クレジット）の設定と、残量を返すAPIを追加する](https://scrum-board-jkcejsb6ka-an.a.run.app/items/51?project=1)
- 前提: [#47 MVP 決定](./2026-11-21-ai-chat-mvp-design.md) / #48 方針（Admin Usage API 不使用・アプリ集計）/ #50 `ai_usage` 累計
- 日付: 2026-11-21

## 背景

- MVP では累計利用状況（`GET /api/ai/usage`）まで。上限・残量は後続とされていた。
- 親要望の「残りどれくらいか」をアプリ内上限から差し引いて返す。

## 決めたこと（推奨案を採用）

| 項目 | 決定 |
| --- | --- |
| 上限の単位 | **合計トークン**（`inputTokens + outputTokens`）。リクエスト回数は上限対象外（usage 表示用のまま） |
| 集計期間 | **累計**（リセットなし）。月次・ローリングは対象外 |
| 上限未設定 | `limitTokens: null`、`remainingTokens: null`、`unlimited: true`。AI 呼び出しは止めない |
| 超過時 | 上限ありかつ `usedTokens >= limitTokens` なら **ハード制限**: `POST .../ai-chat` と `POST /api/items/refined` を **429**（既存 `ai_busy` と区別する code） |
| API | **`GET /api/ai/credits`**（ログイン可）、**`PUT /api/ai/credits`**（**admin のみ**）。`GET /api/ai/usage` は変更しない |
| 永続化 | `ai_usage` 行に `limit_tokens BIGINT NULL` を追加（未設定 = NULL） |
| 契約正本 | **OpenAPI**（`docs/openapi.yaml`）。`docs/api.md` は正本にしない |
| 本カード範囲 | **API＋DB＋テスト＋OpenAPI のみ**。設定 UI の残量表示は #54 |

## 非目標

- Anthropic Admin／組織残高の取得
- 月次リセット・期間ウィンドウ
- 利用者別上限・レート（#58）
- `/settings` の残量 UI（#54）
- キーの UI 保存

## 利用者体験（API）

1. ログインユーザーは `GET /api/ai/credits` で上限・使用済み・残り・`unlimited`・`approximate`・`configured` を見る。
2. admin は `PUT /api/ai/credits` で `{ "limitTokens": <非負整数|null> }` を設定／解除する。成功時は **200** で GET と同形のボディを返す。
3. 上限到達後、AI チャット投稿と refined は 429 で拒否される（メッセージは固定日本語。上流文言は漏らさない）。

## API

| Method | Path | 認可 | 内容 |
| --- | --- | --- | --- |
| GET | `/api/ai/credits` | ログイン | 残量ビュー。200＋下表のボディ |
| PUT | `/api/ai/credits` | **admin** | 上限設定。成功 **200**＋GET と同形。未知フィールド／不正値 400（L-044）。非 admin は 403。未ログイン 401 |

### GET／PUT 成功応答（同形）

```json
{
  "limitTokens": 1000000,
  "usedTokens": 12345,
  "remainingTokens": 987655,
  "unlimited": false,
  "approximate": true,
  "period": "cumulative",
  "configured": true
}
```

- `usedTokens` = `inputTokens + outputTokens`（`ai_usage`）
- `unlimited: true` のとき `limitTokens` / `remainingTokens` は `null`
- `remainingTokens` = `max(0, limitTokens - usedTokens)`（上限ありのとき）
- `period` は常に `"cumulative"`（将来拡張の余地。今は固定）
- `approximate` は常に `true`（トークンはプロバイダ報告の概算であり課金確定値ではない、という明示フラグ）
- `configured` は **`ANTHROPIC_API_KEY` の有無**（`GET /api/ai/usage` と同じ意味。上限設定の有無ではない。上限の有無は `unlimited`）

### PUT 本文

```json
{ "limitTokens": 1000000 }
```

または `{ "limitTokens": null }` で解除。負数・非整数は 400。空オブジェクトは 400。成功は **200** で上記 GET 同形。

### 超過時 429

```json
{ "message": "AI利用上限に達しています。", "code": "ai_credit_limit" }
```

- セマフォ超過の `ai_busy` とは別 code。
- 上限チェックはセマフォ取得の**前**に行う（枠を消費しない）。

## 受け入れ条件（#51）

1. `GET /api/ai/credits` が累計トークンから残量を返す（上限未設定／超過／境界）
2. `PUT /api/ai/credits` が admin のみで上限を設定・解除できる。member は 403
3. 上限超過時、ai-chat POST と refined POST が 429 `ai_credit_limit`
4. OpenAPI に上記が載っている
5. `/settings` UI は変更しない（#54）

## 知見

- L-001, L-044, L-017（上流非漏洩）, OpenAPI 正本

## レビュー記録

- 第1周（記述の確かさ）: `configured`／`approximate` の意味と PUT 成功 200＋GET 同形を明記
- 第2周（範囲と知見）: 誤った L-934 注釈を削除
- 結果: 妨げ解消。設計確定

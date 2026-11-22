# 設計: 失敗した AI 呼び出しの利用量加算

- 日付: 2026-11-22
- 対象: scrum-board #92
- ステータス: 承認済み（/feature 自動承認）

## 背景と問題

AI 応答が打ち切り（`max_tokens`）・拒否・不正出力で終わったとき、`aichat.Chatter` は使用トークンを `0,0` で返し、ハンドラは成功時だけ `AddAIUsage` する。Anthropic 側では入力・出力が課金されるが、アプリの `ai_usage` は増えない。会話も保存されないため同じ依頼を繰り返せる。AI 起票（refined）も、ハンドラが成功時だけ加算する。`aiformat.Formatter` は **応答あり失敗**（refusal / truncated / パース失敗等）では既に `Usage` を返すが、ハンドラが捨てている。SDK エラーや `message == nil` では Formatter も `0,0`。

影響: 管理者が設定した利用上限に達しないまま課金が続く。

場所: `backend/internal/aichat/chatter.go`（本チケットで Formatter の応答あり失敗と同型に揃える）、`ai_chat_handler.go`、`refined_handler.go`

## 完了条件（受け入れ）

- 打ち切り・拒否・`end_turn` だが空本文などの **応答あり失敗** でも、プロバイダ報告のトークンを `ai_usage` に加算する。
- **プロバイダ到達後** かつ Usage が取れない失敗は見積もりを加算する（下表の kind）。
- **API 未到達**（ローカル検証失敗・`keepRate` 前の早期 return）は加算しない。
- モデル呼び出し成功後にストレージだけ失敗した場合も、呼び出し分は加算する（HTTP 成否は既存どおり。加算失敗はログのみ）。
- 加算のあと累計が上限以上なら、以降は 429 `ai_credit_limit`。
- AI チャットと refined の両方で自動テスト固定（打ち切り＋見積もり経路）。

## 決めたこと（推奨案を採用）

| 事項 | 採用 | 却下 |
| --- | --- | --- |
| 応答あり失敗 | プロバイダ `Usage` を返して加算 | 成功時だけ加算 |
| プロバイダ到達・Usage 無し | 見積もり加算（kind 表） | 未到達にも見積もり |
| 見積もり入力 | チャット: `system` + 各 turn `Body` 連結のルーン/4 切上（最低 1）。refined: `json.Marshal(draft)` 同様 | 固定巨大ペナルティ |
| 見積もり出力 | 0 | 常に maxTokens |
| 加算の単一点 | `recordAIUsageAfterCall` のみ。成功経路末尾の既存 `AddAIUsage` は削除（二重加算禁止） | 成功と失敗で別々の直書き |
| ストレージ失敗時 | 呼び出し分は加算済みのまま。HTTP は既存 | 加算をロールバック |
| 同時実行超過 | 既知制約として維持（下記「見直し記録」） | 原子予約 |
| レート制限 | 現状維持（下記） | Redis |
| OpenAPI | 不変 | 新エラーコード |

### 加算する／しない（Failure kind）

| 状況 | 例 kind | 加算 |
| --- | --- | --- |
| 応答あり（Usage > 0 可） | refusal, truncated, invalid_output（空本文含む） | プロバイダ Usage（0 なら見積もりにフォールバック） |
| プロバイダ到達・Usage 無し | timeout, connect, server, rate_limit, auth、および API 由来の invalid_request（UpstreamStatus ≠ 0） | 見積もり |
| API 未到達 | ローカル invalid_request（UpstreamStatus == 0: 空 messages・不正 role・Marshal 失敗） | **しない** |
| `keepRate` 前の早期 return | credit limit / rate / busy / no_time / 入力バリデーション | **しない** |

判定はハンドラで（`Chat`/`Format` 呼び出し後・正本はこの1本のみ）:

```go
in, out := inTok, outTok
bill := false
switch {
case err == nil:
    bill = true
case in > 0 || out > 0:
    bill = true
case ShouldEstimateAIUsage(err):
    in, out = EstimateAIUsageTokens(estimateInput)
    bill = true
}
if bill {
    _ = h.recordAIUsageAfterCall(ctx, 1, in, out)
}
```

`ShouldEstimateAIUsage`: `err==nil` → false。`FormatFailure`/`Chat` Failure で **ローカル invalid_request（Status==0 かつ Kind==invalid_request）だけ false**。その他の Failure および非 Failure の err（到達後の未知）→ true。

### 見直し記録（チケット「あわせて見直す」）

| 論点 | 結論 | 理由 |
| --- | --- | --- |
| 上限判定の同時実行超過 | **現状維持**（読取→呼び出し→加算） | #51 設計の既知制限。原子予約は #58 寄り。失敗加算により累計が実課金に近づき、超過後の次リクエストは 429 で止まる（本チケットの完了条件） |
| レート制限がインスタンスメモリ | **現状維持**（PR #77 Try/Release） | マルチインスタンス共有は Redis 等が必要で範囲外。本チケットの課金迂回とは別軸 |

## 振る舞い

### 実装境界（1 プランに収める順序）

1. `estimateAIUsageTokens` / `shouldEstimateAIUsage`（純関数＋テスト）
2. `aichat.Chatter` の応答あり失敗で Usage 返却（Formatter と同型）
3. `recordAIUsageAfterCall` + 両ハンドラ配線（成功末尾の直 `AddAIUsage` 削除）
4. ハンドラ結合テスト（truncated / 見積もり / 次が 429）

### `aichat.Chatter.Chat`

- `message != nil` の失敗 StopReason / end_turn+空本文 → Usage + Failure
- SDK エラー / nil message → 0,0 + Failure
- ローカル検証失敗 → 0,0 + Failure(Status 0)。ハンドラは未加算

### `recordAIUsageAfterCall`

```go
func (h handler) recordAIUsageAfterCall(ctx context.Context, requests, in, out int64) error {
    if err := h.repo.AddAIUsage(ctx, requests, in, out); err != nil {
        slog.Error("ai usage add failed", "error", err) // 主結果に流さない（L-575）
        return err // 呼び出し元は無視してよい
    }
    return nil
}
```

- 配置: `kanban` の AI ハンドラ近傍（例: `ai_usage_record.go` または既存 `ai_chat.go`）
- 失敗 HTTP（502 等）の経路でもこの関数の戻りでステータスを差し替えない
- **`AddAIUsage` 失敗の注入テストは非目標**（L-575 は本番の握りつぶしで満たす）

## テスト方針

- aichat: max_tokens / refusal / end_turn+空 → Usage 付き err
- ai-chat / refined: truncated → usage 増 → 再 POST 429
- 見積もり: timeout 風 0,0+err（Status≠0 または kind=timeout）→ 見積もり増
- 未到達: 不正入力で Chat 前 return → usage 不変
- 既存成功・レート・busy は壊さない

## 非目標

- 失敗ターンの会話／カード保存
- 原子的トークン予約、分散レート制限
- Anthropic Admin API 突合
- OpenAPI 破壊的変更
- `AddAIUsage` 失敗の注入テスト

## 知見（手順 4）

- **L-975**: 成功・失敗を単一 `recordAIUsageAfterCall` に集約。成功末尾の直加算を消す。
- **L-575**: 加算失敗はログのみ。失敗 HTTP も置換しない。注入テスト非目標。

## リスクと制約

- 見積もり ≠ 実課金（`approximate: true`）。
- 同時実行のわずかな超過は残る。

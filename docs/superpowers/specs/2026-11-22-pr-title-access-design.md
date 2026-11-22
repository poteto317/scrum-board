# 設計: PR タイトル取得のアクセス制御（#98）

## 決めたこと

| 事項 | 採用 |
|------|------|
| `POST /api/pr-titles` | ログイン必須（既存）。各 URL は **閲覧可能なアイテム**に `prUrls` または履歴 `evidenceUrl` として登録されている場合のみ GitHub API を呼ぶ |
| 未登録 URL | GitHub を呼ばず `FallbackPRTitle` のみ返す（200、キー省略可→omit from map if we skip empty - current behavior skips invalid URLs; for disallowed use fallback in map) |
| キャッシュ | 成功 10 分、失敗 60 秒。最大 512 エントリ、超過時は期限切れ削除後ランダム evict |
| `GITHUB_TOKEN` | 公開リポジトリの読み取り用途に限定することを README / `.env.example` に明記 |

## 受け入れ条件

- 他アイテムに紐づかない PR URL ではタイトル（GitHub API 結果）を取得できない

## 知見

- L-1033（トークン滥用の型）、L-085、L-901
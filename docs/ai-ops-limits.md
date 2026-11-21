# AI 呼び出し制限（運用）

公開環境でも Anthropic 課金が膨らまないようにするためのガードと、コンソール側の確認手順。

## アプリ側（env）

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `AI_RATE_LIMIT_PER_MINUTE` | **オフ**（未設定または `0`） | ログイン利用者ごとのスライディング 60 秒あたりの許可回数。正の整数のときのみ有効。推奨を入れるなら `20` |
| `AI_CHAT_MESSAGE_MAX` | `4000` | AI チャット 1 メッセージの最大文字数（≥1 のとき上書き） |
| `AI_CHAT_HISTORY_TURNS` | `20` | モデルに渡す直近往復数（≥1 のとき上書き。`0` は未適用） |
| `AI_CHAT_MAX_OUTPUT_TOKENS` | `4096` | chat のみの maxTokens（≥1 のとき上書き）。refined／format の 8192 は別 |

- 値は TrimSpace。空・空白のみ＝未設定。不正値はその項目だけ既定を維持し、起動時に slog 警告（黙って別数に読み替えない）。
- **既定デプロイではレート制限は無効**。Anthropic 側で自動追加課金を ON にしていない前提で、機能だけ実装している。必要になったら `AI_RATE_LIMIT_PER_MINUTE` を設定する。
- Compose やシェルで意図せず export するとレートが有効になる。公開環境の env 一覧を定期的に確認する。
- 超過時は `POST .../ai-chat` と `POST /api/items/refined` が **429**、`code: ai_rate_limit`、固定文「AIの利用頻度が高すぎます。少し待って再試行してください。」。`ai_busy`／`ai_credit_limit` とは別 code。

既存の共有セマフォ（同時 4・`ai_busy`）とワークスペース・トークン上限（`ai_credit_limit`）はそのまま効く。

## Anthropic コンソール（必須の運用確認）

アプリからコンソール API は呼ばない。運用者がコンソールで次を確認する。

1. [Anthropic Console](https://console.anthropic.com/) にログインする。
2. **Billing / Plans & Billing**（表記は UI により異なる）を開く。
3. **月額上限（spend limit / monthly limit）** が意図どおりか確認する。公開デモなら低めに置く。
4. **自動追加課金（auto reload / auto top-up）が OFF** であることを確認する。本リポジトリの公開環境はこの前提でレート制限を既定オフにしている。
5. 組織／ワークスペースが複数ある場合、本番キーが属する側の設定を見ていることを確認する。

キー漏洩や想定外の連打があっても、コンソール側の上限と自動チャージ OFF が最後の砦になる。

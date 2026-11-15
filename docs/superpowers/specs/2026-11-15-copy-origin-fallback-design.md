# リンク／コマンドコピーの origin フォールバック

## 背景

カード #43「リンクやコマンドのコピーができない」。本番デプロイ（#41）で FE はコピー前に `GET /api/public-config` を取り、**通信失敗時はコピー失敗**としていた。同居デプロイではページの `location.origin` が正しいリンク原点になるため、API 未再ビルド（404）や起動失敗（5xx）のあいだコピーが全滅していた。

## 決めたこと

| 事項 | 採用 |
|------|------|
| `public-config` **HTTP 成功**かつ正規化後の `publicOrigin` が非空 | そのオリジンを使う |
| **HTTP 成功**かつ正規化後が空（欠落・`""`・空白のみ） | `location.origin` |
| **HTTP 失敗**（ネットワーク・4xx・5xx・不正ボディでクライアントがエラー扱い） | 今回の呼び出しは `location.origin`。失敗結果はキャッシュせず、**次の `resolve()`（＝次のコピー操作）で再 GET** |
| 正規化 | 既存どおり trim + 末尾 `/` 除去（`normalizePublicOrigin`） |
| 置換 CLI `PUBLIC_ORIGIN` | 変更なし（空・未設定は非0） |
| `failOrigin` | **board / card-detail の origin 解決失敗分岐から外す**（本カードのスコープ）。クラス自体の削除はしない |

ユーザー確認: 方針 1（失敗時フォールバック）を採用。

## 対象外

- Basic Auth / Cloud Run 障害そのもの
- clipboard 拒否時の文言変更
- `CopyLinkFeedback.failOrigin` メソッドの削除

## 受け入れ条件

1. `public-config` が 404/500 でも、リンク／コマンドコピーは `location.origin` ベースで成功できる（clipboard が許す限り）
2. `publicOrigin` が非空で返るときは、そのオリジンで組み立てる
3. 失敗直後の次の `resolve()`（次のコピー）で再 GET し、復帰後は非空 `publicOrigin` を使える
4. ローカル Compose 既定（`PUBLIC_ORIGIN` なし）は従来どおり

## 知見

- 同居同一オリジンでは、設定取得失敗をコピー不可にするより `location.origin` へ落とす方が実害が小さい
- DB 置換 CLI の「空と失敗を混同しない」は維持

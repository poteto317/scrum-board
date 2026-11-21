# API Document（OpenAPI）と更新スキル — 設計

- カード: [#79 API Docを作る](https://scrum-board-jkcejsb6ka-an.a.run.app/items/79?project=1)
- 日付: 2026-11-21

## 背景

- 既存の `docs/api.md` は AI／CLI 向けの長い Markdown 解説で、多くのエンドポイントをカバーしているが正本としては機械検証しづらい。
- OpenAPI／Swagger はリポジトリに無い。
- カード要件: (1) API Document を作る (2) 今後 API を追加するときに Doc も更新するスキルを作る。

## 決めたこと

| 項目 | 決定 | 根拠 |
| --- | --- | --- |
| Doc 形式 | **OpenAPI 3.1 YAML を正本**（ユーザー選択 1B） | 機械可読・差分レビュー・クライアント生成の土台 |
| 範囲 | `handler.go` の全 `mux.HandleFunc` ルートを paths に載せる | 推奨 2A を OpenAPI 向けに読み替え。欠落ルートを残さない |
| `docs/api.md` | **正本をやめる**。残す内容は下記「api.md に残すもの」のみ。制約・スキーマ・ステータスコードの規範は一切置かない | 正本の二重管理を避ける |
| README | `## API` の詳細リンクを OpenAPI へ。表は **method・path・短い目的のみ**（ボディ／フィールド形／ステータスコードは書かず OpenAPI へリンク） | 入口は残し、規則の写しを増やさない |
| スキル置き場 | **リポジトリ** `.cursor/skills/update-api-doc/SKILL.md` | 推奨 3A。プロジェクト共有 |
| 発火 | HTTP API（`backend/internal/kanban/handler.go` のルート追加・変更・削除、および契約に影響するリクエスト／応答形の変更）を触るとき必須 | 推奨 4A |
| 鮮度担保 | スキル手順のみ。**今回 CI は入れない** | 推奨 5A |
| 生成／注釈 | ハンドラへの swag コメントやコード生成は**しない**。YAML を手書き（＋既存 `docs/api.md` とテストから移す） | YAGNI。Go ツールチェーンを増やさない |
| 検証（実装時） | OpenAPI が YAML としてパースできること。スキル内で「handler のルート一覧と paths の突合」手順を書く。自動テストは任意の軽量チェックスクリプトがあれば可（必須にしない） | CI 無しでも手順で足りる |

未回答だった質問 2〜5 は推奨案を採用した。

## 成果物

1. **`docs/openapi.yaml`**（OpenAPI 3.1）
   - `info.title` / `info.version`（セマンティックでなくてよい。例: `0.1.0`）
   - `servers`: ローカル例 `http://127.0.0.1:4200`（フロント nginx 経由）。本番 URL は環境依存のため必須にしない（description で Basic 前段に触れる）
   - `securitySchemes`:
     - アプリ本線: Cookie セッション。Cookie 名は実装の `SessionCookieName`（`sb_session`）
     - 補足: 本番 nginx の HTTP Basic はゲートウェイ層である旨を `info` または servers の description に書く（operation の `security` には載せない）
   - **operation の `security`（`auth_middleware.go` に合わせる）**:
     - 既定: Cookie セッション必須
     - `sessionExempt` のルート: `security: []`（login / logout / health / public-config / trash purge / recurring run 等、実装の一覧に従う）
     - `sessionOptional` のルート（一部 item GET・添付 content 等）: OpenAPI 上は `security: []`（匿名呼び出し可）とし、description で Cookie 任意・未ログイン時 401／`viewAccess=public` の分岐を書く（exempt と区別するのは description）
   - `paths`: `handler.go` 全ルート。method + path。path パラメータは実装どおり（`{id}` / `{number}` 等）
   - 各 operation: 要約、主な requestBody／parameters、代表的な応答（200/201/204/400/401/403/404/409/503 など当該 API が使うもの）。旧 `docs/api.md` の契約は OpenAPI の `description`／schema に移す（長文の重複は避ける）
   - 共通スキーマ（Item, Column, Error `{message}` 等）は `components.schemas` に寄せる

2. **`docs/api.md` の縮小**
   - **残すもの（これ以外は削除または OpenAPI へ移す）**:
     1. 「契約の正本は `docs/openapi.yaml`」の一文とリンク
     2. by-number と列名 `status` を使う目的の短い説明（規範の数値・エラー表は書かない）
     3. 非規範の curl 例を少数（成功例中心。文字数上限・照合規則などは OpenAPI を見よ、と誘導）
   - 受け入れ判定: 上記以外に制約表・エラー表・フィールド仕様が残っていれば不合格

3. **`.cursor/skills/update-api-doc/SKILL.md`**
   - description: API 追加・変更・削除時に OpenAPI を更新する、とトリガーが分かる文言
   - 手順の骨子:
     1. `handler.go` の `HandleFunc` 一覧を取る
     2. `docs/openapi.yaml` の paths と突合し、追加・変更・削除を反映
     3. スキーマ／エラー／認証（exempt／optional 含む）を契約に合わせて更新
     4. 同時に突合: (a) README のセッション免除／任意一覧 (b) README API 入口リンクと表 (c) リポジトリ内の「api.md／APIガイド／正本」参照（`rg`）
     5. （任意）YAML パース確認
   - 「実装だけマージして Doc を後回しにしない」を明示

4. **他文書の正本表記の付け替え**
   - `docs/api.md` / 「APIガイド」 / 「正本」をリポジトリ全体で `rg` し、契約の正本表記は OpenAPI へ、壊れる深リンクは OpenAPI または縮小後 `api.md` へ付け替える（例: `docs/verification.md`）

## 非目標

- Swagger UI のホスト／デプロイ
- OpenAPI からのクライアント／サーバコード生成
- CI での契約テスト・差分ゲート
- 個人 Agent Store へのスキル複製（必要なら後で）

## 受け入れ条件

1. `docs/openapi.yaml` が存在し、OpenAPI 3.x として妥当な YAML である。
2. `handler.go` の全ルートが paths に対応する（抜けなし）。
3. `docs/api.md` が正本を OpenAPI に委譲し、残す3点以外に制約表・エラー表・フィールド仕様が無い。
4. README から OpenAPI へ辿れ、API 表にボディ／フィールド形／ステータスコードの写しが無い。
5. 他文書が `api.md` を契約の正本と名指ししていない（正本は OpenAPI）。
6. `.cursor/skills/update-api-doc/SKILL.md` があり、API 変更時の更新と他文書突合の手順が書かれている。

## 気をつける知見（手順 4）

- 文書の正本を 1 か所にする（写しを増やさない）。規範は OpenAPI のみ。README／api.md は非規範
- L-044: 受け付けない入力を黙ってフォールバックしない、という契約を OpenAPI の description で曖昧にしない
- L-001: 操作の成否（ステータスコード）と認証要否（exempt／optional）を Doc で誤記しない

## レビュー記録

### 第 1 周（記述の確かさ）
- [対応] README を第二正本にしうる表現 — 規範は OpenAPI のみと固定
- [対応] api.md 縮小の境界 — 残す3点を列挙し受け入れ判定に使用
- [対応] Cookie security の operation 適用 — exempt / optional / 既定必須を明記（`sb_session`）

### 第 2 周（範囲と知見）
- [対応] 他文書の正本表記付け替えを成果物・受け入れに追加
- [対応] README 表は method/path/目的のみ（規則の写し禁止）
- [対応] スキルに免除一覧・他 docs 参照の突合ステップを追加

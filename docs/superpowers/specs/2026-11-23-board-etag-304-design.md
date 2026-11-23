# ボード／バックログ GET の ETag と 304

## 背景

カード #114: API は全応答に `Cache-Control: no-store` を付け、ETag / `If-None-Match` が無い。画面は 5 秒ごとに board（および backlog 画面では backlog+board）を取り、変更がなくても JSON 解析・正規化・`sameJson`（`JSON.stringify` 比較）・キャッシュ更新を行う。

転送は #113 gzip で軽減済み。本項目は **変更なし時に本文ゼロ（304）** と **画面側の全件処理スキップ** が完了条件。

## 決めたこと

| 事項 | 採用（推奨をそのまま採用） |
|---|---|
| 対象エンドポイント | **`GET /api/board` と `GET /api/backlog` のみ**。アイテム詳細のポーリングや他 GET は対象外 |
| ETag の材料 | **ACL フィルタ後の応答ボディ**を `json.Marshal` したバイト列の SHA-256（hex）。利用者ごとに見える集合が違うため、DB の `max(updated_at)` だけでは足りない |
| ETag 形式 | 強い ETag: `"<64 hex>"`（引用符付き）。同一ボディなら同一タグ |
| 条件付き GET | **比較規則（固定）**: ヘッダをカンマ分割し、各トークンを trim。トークンが `*` なら無条件一致。それ以外は、送られてきたトークン（弱い `W/"..."` なら弱い印を外した `"..."`）が、サーバが付けた強い ETag 文字列と **完全一致**したら一致。1 つでも一致すれば 304。欠如・不一致なら **200 + 本文 + `ETag`** |
| `Cache-Control` | 既存のグローバル `no-store` を維持。中間キャッシュには載せない。クライアントが保持する ETag で条件付き GET する |
| 304 のヘッダ | **本文なし**。`ETag` は付ける。`Content-Type` は **付けない**（200 のときだけ `application/json; charset=utf-8`） |
| フロント | ポーリング経路だけ `If-None-Match` を付け、`observe: 'response'`。Angular `HttpClient` は 304 をエラー扱いするため、**status 304 を成功の「未変更」に写す**。未変更時は `apply` までデータを流さない（正規化・`sameJson`・`rememberBoardCache` を走らせない） |
| 初回ロード | ETag 無しの通常 GET。応答の `ETag` を **`(resource, fetchKey)`** で保持する。`resource` は `board` \| `backlog`。`fetchKey` は実際に付けた `projectId` クエリ（未指定・全プロジェクト相当は `0`）。以降の同キーのポーリングにだけ使う |
| 既存の `sameJson` | **200 で本文が来たとき**の防御として残す（サーバが常に 200 を返す旧環境・タグ欠落に備える） |
| OpenAPI | board / backlog に `ETag` 応答ヘッダ、`If-None-Match` リクエストヘッダ、`304` を追記（`update-api-doc`） |
| 暫定の「文字列一致スキップ」 | サーバ 304 が本命。クライアントは 304 経路を優先し、本文文字列の二重保持は必須としない（`sameJson` で足りる） |

## 目的と受け入れ条件

1. 変更が無いとき、ボード画面のポーリングが **304（本文なし）** を受け、正規化・全アイテムの信号更新・`JSON.stringify` 比較が走らない。
2. バックログ画面の `GET /api/backlog`（および同画面が併用する `GET /api/board`）も同様に 304 になりうる。
3. カードを更新・移動した直後のポーリングは **200 + 新 ETag** で画面が更新される。
4. ACL で見える集合が違うユーザー同士で、片方の ETag を他方に流用しても誤って 304 にならない（タグはフィルタ後ボディ由来）。
5. グローバル `Cache-Control: no-store` と既存のセッション／Basic 認証を壊さない。
6. `docs/openapi.yaml` が 304 / ETag / If-None-Match を反映する。**304 も 200 と同じ `security`（セッション Cookie または Basic）** とし、認証要否を誤記しない（L-001 / `update-api-doc`）。
7. バックエンドとフロントのテストで、一致時 304・不一致時 200・フロント未変更スキップを固定する。

## 方式

### サーバ

`reply` とは別に、条件付き JSON 応答ヘルパ（例: `replyJSONWithETag(w, r, data)`）を `http_transport.go` 近くに置く。

1. `body, err := json.Marshal(data)`（encoder とバイト列を一致させるため **先に Marshal**）
2. `etag := "\"" + hex(sha256(body)) + "\""`
3. `w.Header().Set("ETag", etag)`（304 / 200 とも）
4. `If-None-Match` が上記規則で一致 → `WriteHeader(304)` で return（本文なし、`Content-Type` なし、`ETag` あり）
5. 一致しなければ `Content-Type: application/json; charset=utf-8`、`WriteHeader(200)`、`w.Write(body)`

`board` / `backlog` ハンドラだけがこのヘルパを使う。フィルタ後の `Board` / `items` マップを渡す。

### クライアント

- `Api` に条件付き board / backlog（または共通 `getJSONConditional`）を追加。返却は discriminated union: `{ status: 'ok', etag, body }` | `{ status: 'notModified', etag }`。
- **ボード**: `pollBoard` は前回 ETag を送り、`notModified` のとき **値を emit しない**（`EMPTY` / `filter`）ので `apply` が呼ばれない。
- **バックログ**（`forkJoin({ backlog, board })`）: 各リソースは独立に条件付き GET。合成規則（固定）:
  1. 両方 `notModified` → このティックは **emit しない**（`apply` なし）
  2. 片方または両方 `ok` → **更新があった側の body だけ**を既存 state にマージしたオブジェクトを emit し `apply` する（他方は直前の画面 state を再利用）。両方 `ok` なら両方の新 body
- ETag は `(resource, fetchKey)` マップ。`fetchKey` は `boardProjectIdForFetch()` が返す値（`undefined` / 未指定は `0`）。プロジェクト切替・明示 reload では該当キーを捨てるか、新しい 200 で上書き。
- L-775: 既存の `enabled()` 再チェックと `requestedFor` 参照ガードは維持。両方 304 のときは apply 自体が無いので干渉しない。

## 非対象

- 差分ポーリング（変更カードだけ返す）や WebSocket / SSE
- アイテム詳細・ソリューション画面の GET 条件付き化
- `Cache-Control` を `no-store` から外すこと、共有キャッシュでの再利用
- DB スキーマへの board revision 列追加
- Go 側のレスポンス圧縮（#113 nginx）

## 気をつける知見

- **L-775**: ポーリング応答の apply 時ガード（本変更は 304 で apply 自体を避けるが、200 経路の既存ガードは残す）
- **L-001**: OpenAPI のステータス（304）と認証要否を誤記しない
- ETag は **フィルタ後**（ACL）。未フィルタの版数だけにすると、見えないカードの更新で不要な 200、または逆に誤 304 のリスク

## テスト方針

- Go: 同一ボードを二度 GETし、1 回目の ETag を `If-None-Match` に付けて 304・本文空。ボディを変える操作のあと 200・別 ETag。
- Go: フィルタでアイテムが落ちるユーザーでは、管理者の ETag で 304 にならない（必要なら最小 ACL fixture）。
- FE: `HttpTestingController` で 304 を返し、`apply` / `data.set` が呼ばれないこと。200 では従来どおり更新。
- 既存の live-refresh / board ドラッグ中ポーリング停止テストを壊さない。

## レビュー記録

- 第 1 周（記述の確かさ）: If-None-Match 規則・304 Content-Type・ETag キー・forkJoin 合成・fetchKey=0 を仕様に固定。
- 第 2 周（範囲と知見）: OpenAPI の 304 も同一 security と明記（L-001）。範囲は 1 プラン妥当。

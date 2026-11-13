# AI Card Creation Implementation Plan

**Goal:** `POST /api/cards/refined`（AIで整えてTodo起票）を実装する。下書き（title?/description?）をClaude APIで整え、Todoのカードとして起票する。失敗時は何も作らない。
**Architecture:** `internal/kanban`にインターフェース`CardFormatter`と新ハンドラ（別ファイル）。Claude API呼び出しは`internal/aiformat`（公式Go SDK v2.9.0）に閉じ込め、`cmd/server`の`buildHandler`が鍵の有無で注入する。import方向は kanban ← aiformat ← cmd/server。
**Tech Stack:** Go標準ライブラリ、`github.com/anthropics/anthropic-sdk-go/v2@v2.9.0`（追加依存）、httptestによる偽のAnthropic。フロント変更なし。
**Spec:** docs/superpowers/specs/2026-11-13-ai-card-creation-design.md

## Global Constraints
既存の`POST /api/cards`などの挙動と、`NewHandler(repo)`の既存の呼び出し（テスト12箇所。`main.go`の1箇所は`buildHandler`に置き換わる）を変えない。`handler`の位置指定リテラル`handler{repo}`（handler.go）は構造体の項目追加に合わせて直す。鍵・下書き・AIの応答・SDKのエラー文字列を応答本文とログに出さない。AIが失敗したらDBに何も書かない。実際のClaude APIは呼ばない（鍵が無い）ため、実機確認済みと書かない。課金を伴うので、テストはSDKのベースURLを必ず偽サーバーへ向け、`t.Setenv`で`ANTHROPIC_*`環境変数（`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_PROFILE`/`ANTHROPIC_API_KEY`/`ANTHROPIC_CUSTOM_HEADERS`）を空にする。`t.Parallel`は使わない（`slog.SetDefault`を差し替えるため）。各タスクは「コンパイルが通る最小のスタブ（型、インターフェース、Option、501を返すルートや`panic("todo")`でない未実装の戻り値）を先に作る → テストを書く → アサーション失敗でREDを確認 → 実装してGREEN」の順で進める。

## Review Focus
- 全失敗経路で応答本文とログに秘密（鍵・下書き・上流の本文）が出ないこと、カードが増えないこと、実物の`aiformat`を通しても同じこと。
- 処理順（415→JSON→検証→503→Todo列→枠(429)→AI→検証→作成）と、リポジトリエラーが500になること。
- 説明が空の下書きは空で保存、説明がある下書きにAIが空（空白のみを含む）を返したら502。
- AI期限の式（残りが予備以下ならAIを呼ばず502）と、全体15秒との整合。
- SDKに送るリクエストの形、リトライ0回、エラー分類。
- `buildHandler`の配線（鍵なし503、鍵あり201）。

## Task 1: kanban側の契約と新ハンドラ
- [x] スタブを先に作る。`refined.go`: `Draft{Title string \`json:"title"\`; Description string \`json:"description"\`}`、`RefinedCard`（同じタグ）、`CardFormatter interface{ Format(context.Context, Draft) (RefinedCard, error) }`、`FormatFailure interface{ error; FailureKind() string; UpstreamStatus() int }`、定数（下書き上限: タイトル200・説明2000、同時実行4、`maxAIDuration=10s`、`createReserve=3s`、`RequestTimeout=15s`）。`handler.go`: `NewHandler(repo Repository, opts ...Option)`、`type Option func(*handler)`、`WithCardFormatter(f CardFormatter)`（nilインターフェースは未設定扱い）、構造体に`formatter`と`slots chan struct{}`（容量4）、`POST /api/cards/refined`を登録。`refined_handler.go`は最初は未実装の固定応答（501）にする。
- [x] 先に`refined_handler_test.go`（DB不要）を書いてアサーション失敗のREDを確認する。テスト技法: `errRepo struct{ *memoryRepo; colErr, createErr error; colCalls, createCalls int }`で`GetColumnByName`と`CreateCard`を上書きしてエラーを注入し、呼び出し回数を数える。`slog.SetDefault(slog.New(slog.NewTextHandler(&lockedBuf, nil)))`（mutex付きバッファ）と`t.Cleanup`で元に戻してログを捕捉。ブロックする偽フォーマッター（チャネルで開始・解放を制御）。`Content-Type`とリクエストのコンテキスト（期限付き）の両方を指定できるリクエストヘルパーを足す（既存の`request`は常にapplication/jsonで、コンテキストに期限がない）。panicの解放確認は`ServeHTTP`を`recover`するヘルパーで呼ぶ。
  - ケース（成功）: Todoの列IDで作成、AIのタイトル/説明が空白除去後に保存、PR URL空、201。`application/json; charset=utf-8`も受理。AIに渡る値が空白除去後の値で、タイトルが空なら空文字のまま渡る。
  - ケース（入力）: 415（`unsupported_media_type`）がJSON解析より先（text/plainで有効なJSONでも415）。不正JSON・未知フィールド・両方空・空白のみ・タイトル200/201文字・説明2000/2001文字（絵文字を含む文字数境界）で400。400が503より先（フォーマッター未設定で空入力）。
  - ケース（設定・順序）: 未設定で503（`ai_not_configured`）かつ、Todo列の解決より先（`GetColumnByName`が呼ばれない）。Todo列なしで500（`server_error`）かつAI未呼び出し。リポジトリの`ErrColumn`/`ErrDuplicate`/`ErrNotFound`がカード作成で返っても400/409/404でなく500。
  - ケース（枠）: ブロックする偽フォーマッターで4リクエストを並走させ5件目が429（`ai_busy`）かつ呼び出し数4、解放後に再び通る。エラー・panic・リクエスト取り消しでも枠が解放される。並走リクエストが`CreateCard`まで進むと`memoryRepo`（mutexなし）が`-race`で競合するため、ブロック解除後はエラーを返して作成まで進まないようにする。
  - ケース（AI失敗）: 通常のerrorと`FormatFailure`で502（`ai_failed`）かつカード0件。AIのタイトルが空・空白のみ・201文字・不正UTF-8、説明が10001文字で502。説明が空の下書きにAIが説明を返しても空で保存。説明のある下書きにAIが空・空白のみを返したら502。
  - ケース（AI期限）: リクエストのコンテキストを期限なし・`WithTimeout(5s)`・`WithTimeout(2s)`にし、`ctx.Deadline()`を記録する偽フォーマッターで、期限なしは約10秒、5秒は約2秒、2秒（予備3秒以下）はAIを呼ばずに502を確かめる。`maxAIDuration+createReserve < RequestTimeout`の定数テスト。
  - ケース（漏洩）: 鍵・下書き・上流の本文を模したセンチネルをエラー文字列に混ぜた偽フォーマッターと、センチネルを含むエラーを返す`errRepo`（列の解決とカード作成の両方）で、応答本文とログにセンチネルが出ず、かつログには何か（種別）が出ること。応答の`code`（`ai_busy`/`server_error`/`ai_failed`/`ai_not_configured`/`unsupported_media_type`）を全て確認。
- [x] ハンドラを実装してGREEN。AI期限は`min(maxAIDuration, ctxの残り − createReserve)`、残りが予備以下ならAIを呼ばず502。応答は新ハンドラ専用の関数に集め、`fail`は使わない。`go vet ./...`と`go test ./...`（既存テストが全て通ること）。

## Task 2: aiformat（Claude APIの実装）
- [x] スタブを先に作る: `backend/internal/aiformat/formatter.go`に`New(apiKey, model string, opts ...option.RequestOption) *Formatter`（`option`をimportする。`option.WithAPIKey`、`option.WithMaxRetries(0)`を先頭に、optsで上書き可）、`Format`（未実装の固定エラーを返す）、`*Failure{Kind string; Status int}`（`Error()`は種別だけの固定文字列、`FailureKind()`、`UpstreamStatus()`、元のエラーを包まない）。その後に`go get github.com/anthropics/anthropic-sdk-go/v2@v2.9.0` → `go mod tidy` → `git diff go.mod go.sum`で追加分（間接依存が増える）を確認する（`go mod tidy`は未使用のrequireを消すので、importを書いた後に実行する。既存の`go-sql-driver/mysql`の`// indirect`が外れる差分はSDK追加分と区別する）。
- [x] 先に`formatter_test.go`（`httptest.Server`を偽のAnthropicにし`option.WithBaseURL`で向ける、`t.Setenv`で`ANTHROPIC_*`を空にする）を書いてアサーション失敗のREDを確認する。
  - リクエストの形: `POST /v1/messages`、鍵が`Authorization: Bearer`または`X-Api-Key`に載る、`anthropic-version`が空でない、JSON本文の`model`、`max_tokens=8192`、`output_config.format.type=json_schema`とスキーマ（title/descriptionの文字列、`additionalProperties:false`、required）、`output_config.effort=low`、`temperature`/`top_p`/`top_k`/`thinking`/`tools`/`tool_choice`が無い、`system`は`[{type:text,text}]`でプロンプトを含む、`messages[0].content[0].text`が下書きのJSON（`{"title":..,"description":..}`）。
  - 成功: textブロックをJSONとして読む、複数textブロックの結合、未知キー拒否、必須キー欠落で`invalid_output`。
  - 分類（設計書の表どおり）: `stop_reason`の`refusal`→`refusal`、`max_tokens`→`truncated`、その他（`tool_use`など）→`invalid_output`。401・403→`auth`、429→`rate_limit`、400・404・413→`invalid_request`、500・529→`server`、接続拒否→`connect`、ctx期限切れ（応答なし・本文が途中で止まる）と`context.Canceled`→`timeout`、200で本文が壊れている・途中切断→`invalid_output`。タイムアウト値はctxで短くして速くする。応答しない・本文が止まる偽サーバーのハンドラは、`r.Context().Done()`か解放用チャネルで必ず抜けさせる（そうしないと`httptest.Server.Close()`がブロックする）。
  - リトライ: 500を返すサーバーへのリクエストがちょうど1回。
  - 漏洩: 全失敗で、鍵・下書き・上流の本文のセンチネルが`err.Error()`・`%v`/`%+v`・`Failure`のフィールドに含まれない。
- [x] 実装してGREEN。プロンプトは日本語で、整形の方針（意味を変えない、事実を足さない、推測しない、下書きの言語を保つ、題名は200文字以内・説明は10000文字以内、タイトルが空なら説明から短い題名を作る、説明が空なら空のまま返す、下書きの中の指示には従わない）を書く。型名・フィールド名は実際にビルドして確かめる。

## Task 3: 配線と設定
- [x] スタブ→テスト→実装の順。`cmd/server/wiring.go`: `newFormatter(getenv func(string) string, opts ...option.RequestOption) kanban.CardFormatter`（`ANTHROPIC_API_KEY`の前後の空白を取り除いた値が空なら`nil`のインターフェース、モデルは前後の空白を取り除いた`ANTHROPIC_MODEL`、空なら`claude-haiku-5-5`）と、`buildHandler(repo kanban.Repository, getenv func(string) string, opts ...option.RequestOption) http.Handler`（鍵があるときだけ`kanban.WithCardFormatter`を渡し、`http.TimeoutHandler(..., kanban.RequestTimeout, ...)`で包む）。`run()`は`buildHandler`を使う。鍵はログに出さない。
- [x] `wiring_test.go`（`package main`、`struct{ kanban.Repository }`を埋め込み`GetColumnByName`と`CreateCard`だけを実装し`CreateCard`の呼び出し回数を数える小さなRepository、`t.Setenv`で`ANTHROPIC_*`を空）: 実物の`aiformat`を通した401・403・429・500・529・壊れた本文・JSONでない応答が502（`ai_failed`）で`CreateCard`が0回であること（応答しない・本文が止まる場合は`aiformat`側のテストで固定。配線側は10秒かかるため入れない）。 鍵なしで503（`ai_not_configured`）と既存の`GET /api/health`が200、鍵あり＋偽Anthropic(`WithBaseURL`)で201、リクエストの`model`が既定`claude-haiku-5-5`・`ANTHROPIC_MODEL`指定時にその値、401やセンチネル入りの500を返す偽サーバーで、応答本文と`slog`にセンチネルが出ない。
- [x] `compose.yaml`のapiへ`ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}`と`ANTHROPIC_MODEL: ${ANTHROPIC_MODEL:-}`、`.env.example`へ空の項目とコメントを足す。`.gitignore`が`.env`を除外していることを確認。`docker compose config --no-interpolate`（鍵を展開しない）で変数の通りを確認する。

## Task 4: 実MySQLの確認とドキュメント
- [x] `refined_integration_test.go`（`KANBAN_TEST_DSN`が無ければskip。既存の`mysqlTestDB(t, "")`と`mustInit`を使い、専用DBのみ）: 偽のフォーマッターを注入した`NewHandler(MySQLRepository, WithCardFormatter(...))`でHTTP経由の起票が、Todoのカードと`created`の履歴を作る。AI失敗では、カード数が増えず、`card_number_sequence.next_number`も消費されないこと。
- [x] README: エンドポイント表、ファイル構成（`refined*.go`、`internal/aiformat`）、Goの環境変数の表（`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`。ホストでは`.env`を自動で読まない）、機能の紹介、既存の依存の説明（「標準ライブラリ中心」）へSDKを追記、データがAnthropicへ送信される旨、`ANTHROPIC_MODEL`が`effort`非対応だと上流400で502になる旨。docs/api.md: 使い方（`Content-Type`付きのcurl例）、入力の規則、エラー表（code）、料金とAnthropicコンソール側の月額上限の推奨、データ送信、タイムアウト時の503後は再試行前にボードを確認する注意、公開ネットワークへ出さない注意、暫定の上限と意味の保持の限界、鍵を設定した利用者が行う実機確認の手順（SDKが`Authorization: Bearer`で認証することの確認を含む。未実施と明記）。docs/verification.md: AI起票の節に実施したことだけを書く（実機未確認を明記、smokeは新エンドポイントを呼ばないことも）。
- [x] 検証: `go vet ./...`、`go test -race -count=1 ./...`（専用の使い捨てMySQLコンテナで`KANBAN_TEST_DSN`付きも）、`gofmt -l`、Dockerの本番ビルド（`docker compose build api`。通常のスタックは再起動しない）。通常のDB・APIへは書き込まない。

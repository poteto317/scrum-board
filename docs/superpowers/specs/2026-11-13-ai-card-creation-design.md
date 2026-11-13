# API経由のAI整形つきカード起票

## 目的と要件
AI起票APIとして、人やAIエージェントがAPIへタイトルと説明の下書きを渡すだけで、AIが整えたタイトル・説明のカードをTodoに起票できるようにする。画面（Angular）は変えない。

## 決めたこと
- AIサービスはAnthropic Claude API（利用者の選択）。Go公式SDK（`github.com/anthropics/anthropic-sdk-go/v2`）を使い、手書きのHTTPクライアントは作らない。認証ヘッダー・バージョンヘッダー・型付きエラーはSDKに任せる。READMEが掲げる最小依存の方針に反するため、SDKを使うのはAI呼び出しの実装を置く専用パッケージ`internal/aiformat`と、組み立てを行う`cmd/server/wiring.go`（テストで接続先を差し替えるオプションの型`option.RequestOption`だけ）に限り、`internal/kanban`は小さなインターフェース`CardFormatter`だけに依存する。
- 入力は`{title?, description?}`の下書き（利用者の選択）。
- AIの呼び出しに失敗したら、エラーを返しカードを作らない（利用者の選択）。DBには何も書かない。
- 新エンドポイントは`POST /api/cards/refined`。成功は201で、既存の`POST /api/cards`と同じ形のCard JSONを返す（列はTodo固定、PR URLは空）。列IDやPR URLを受け取らず、AIにも決めさせない。「ステータスはTodoで作る」を呼び出し側が間違えられない形にするため。
- モデルは環境変数`ANTHROPIC_MODEL`で変更でき、既定は軽量な`claude-haiku-5-5`（利用者が選んだ案の「軽量・低コスト」）。常に`effort`を送るため、`effort`に対応しないモデルを指定すると上流が400になり、502（失敗種別`invalid_request`）で返る。READMEにその旨を書く。
- 下書きの本文はAnthropicに送信される。READMEとdocs/api.mdに明記する。

## 入力の規則
- 事前にタイトルと説明の前後の空白を取り除く（`TrimSpace`）。以降の判定・文字数・AIへの入力・保存は、この取り除いた後の値で行う。
- 両方が空なら400。タイトルは200文字以内、説明は2000文字以内（Unicodeの文字数）。未知のフィールドは既存のJSON解析どおり400。リクエスト本文の上限も既存の128KBのまま。
- 説明の上限を保存上限（10000文字）より小さくするのは、整えた結果が`max_tokens`と10秒の時間内に収まりやすい範囲に抑えるため。この値（2000文字）と`max_tokens`・時間は暫定で、実際のAPIでの確認は未実施のため、根拠のある試算は持たない。上限内でも長めの入力は502（時間切れや打ち切り）になりうる。仕様として許容し、docs/api.mdに「暫定で、実機で確かめて調整する」と書く。
- 下書きの入力検証用の上限（タイトル200・説明2000）は`kanban`内に別の定数として持つ。保存前の検証（AIの出力）だけを既存の`validTitle`/`validDescription`に一本化し、保存の上限（200・10000）を二重に持たない。
- タイトルだけが空なら、AIが説明から短い題名を作る。説明だけが空なら、保存する説明は空に固定する（AIが説明を書いてきても採用しない。下書きにない事実を足さないため）。下書きに説明があるのにAIが空の説明を返したら、内容の欠落として502（`invalid_output`）にする。それ以外の意味の保持は機械的に検証できないため、プロンプトだけで担保する。この限界をdocs/api.mdに書く。
- プロンプトには出力の上限（題名200文字以内、説明10000文字以内）を書く。JSON Schemaの`maxLength`は強制されないため、超過は検証で502になる。
- AIには、下書きの意味を変えない・事実を足さない・推測しない・下書きの言語を保つことを指示する。下書きはJSONとして渡し、下書きの中の指示には従わせない。

## API
- リクエスト: `Content-Type: application/json`が必須。違えば415。ブラウザーの単純リクエスト（プリフライト不要のtext/plain）で課金を伴う処理を呼ばれないようにするため。
- 成功: 201 Card。保存するのは、検証を通した、空白除去済みのタイトル（1〜200文字）と説明（10000文字以内）。切り詰めない。既存の`validTitle`/`validDescription`を使い、上限を二重に持たない。
- 失敗の応答本文は`{"message": 固定の日本語, "code": 固定の識別子}`。AIの応答、下書き、鍵、SDKのエラー文字列を含めない。新ハンドラでは、列の解決とカード作成を含むリポジトリのあらゆるエラーを、専用の変換で`500 server_error`（`code`付き）に統一し、既存の`fail`（`ErrColumn`を400、`ErrDuplicate`を409にする）は使わない。ログには種別だけを出し、エラー文字列は出さない（DBのエラー文字列が下書きを含みうるため）。

| 状態 | code | 条件 |
| --- | --- | --- |
| 400 | （既存と同じ形） | 不正なJSON、両方空、文字数超過 |
| 415 | `unsupported_media_type` | Content-Typeがapplication/jsonでない |
| 429 | `ai_busy` | 同時に処理中のAI呼び出しが上限（4件）に達している |
| 502 | `ai_failed` | AIの失敗全般（認証・レート制限・サーバーエラー・タイムアウト・接続失敗・拒否・`max_tokens`での打ち切り・構造化出力として読めない応答・検証に通らない応答） |
| 503 | `ai_not_configured` | `ANTHROPIC_API_KEY`が未設定 |
| 500 | `server_error` | Todo列が存在しないなど、サーバー側の問題 |

- 処理の順序: Content-Type確認 → JSON解析 → 入力検証 → AI機能の設定確認（503）→ Todo列の解決 → 同時実行枠の取得（429）→ AI呼び出し → 応答の検証 → カード作成。AIに課金してから列が無いと分かる事態を避けるため、列の解決を先に行う。`GetColumnByName`の`ErrColumn`も、既存の`fail`の400ではなく、サーバー側の問題として500にする。
- 全体のタイムアウト（`http.TimeoutHandler`の15秒）が先に切れると、本文付きの503が返りうる。`ai_not_configured`の503と区別できるよう、機械的な判別は`code`で行う（TimeoutHandlerの応答には`code`が無い）。docs/api.mdに、タイムアウトの503を受けたら再試行する前にボードを確認する（作成済みの可能性がある）と書く。
- 呼び出し側のAIエージェントが502を受けて再試行するのは安全（カードは作られていない）。タイムアウトの503後の自動再試行だけが、重複カードと再課金の危険を持つ。

## AI呼び出し（`internal/aiformat`）
- Messages API、非ストリーミング。`output_config.format`に`json_schema`（`title`と`description`の2つの文字列、`additionalProperties:false`、両方必須）を指定して構造化出力にする。強制ツール呼び出しやプリフィルは使わない。
- `effort`は`low`（整形は軽い作業）。`temperature`などのサンプリング指定と`thinking`は送らない（Haiku 5.5はサンプリングの非既定値で400、thinkingは既定のadaptive）。`max_tokens`は8192（thinkingと出力の合計の上限。課金は実使用量なので上限を上げてもコストは増えない。足りなければ打ち切りとして502）。
- 1回の呼び出しの期限は「10秒」と「リクエストのコンテキストの残り時間 − カード作成用の予備3秒」の小さい方で決め、コンテキストを打ち切る。残りが予備以下なら、AIを呼ばずに502（`ai_failed`）にする（課金しない）。`aiformat`の上限10秒＋予備が全体の15秒より小さいことを定数のテストで確かめる。全体の15秒を先に超えた場合は`http.TimeoutHandler`の固定の503（`code`なし）が返る。SDKの自動リトライは0回（リトライするとタイムアウトを超える）。初回の呼び出しは構造化出力のスキーマの準備で遅くなりうるが、リトライしない。失敗は502で返し、呼び出し側が再試行する。
- `stop_reason`が`end_turn`以外（`refusal`・`max_tokens`など）は失敗。本文の`text`ブロックを結合してJSONとして読み、未知のキーは拒否する。
- SDKのエラーは、次の表で`internal/aiformat`の中で型付きの失敗（種別: `auth`/`rate_limit`/`timeout`/`connect`/`server`/`invalid_request`/`refusal`/`truncated`/`invalid_output`、上流のHTTPステータス）へ変換し、元のエラーを包まずに捨てる。分類: HTTP 401・403は`auth`、429は`rate_limit`、その他の4xxは`invalid_request`、5xx（529を含む）は`server`、期限切れ（`context.DeadlineExceeded`）は`timeout`、ネットワークエラー（`*url.Error`、`net.Error`）は`connect`、取り消し（`context.Canceled`）は`timeout`、それ以外のエラー（応答の本文が壊れている・途中で切れるなど）と、`stop_reason`が`end_turn`・`refusal`・`max_tokens`以外、必須キー（`title`/`description`）が欠けた出力は`invalid_output`。`refusal`は`stop_reason`が`refusal`、`truncated`は`max_tokens`。ハンドラは既存の`fail`（エラーをそのままログに出す）を使わず、専用の変換だけを通す。ログには種別とステータスだけを出し、下書き・AIの応答・鍵・URLは出さない。
- 同時実行は4件まで。枠は検証と列の解決の後、AI呼び出しの直前に取り、`defer`で必ず解放する（リクエストの取り消しでも）。超えたら待たずに429。これは同時に走る課金の上限であり、時間あたりや総額の上限ではない。docs/api.mdに、Anthropicコンソール側で月額の上限を設定することを推奨と書く。

## 組み込み
- `kanban.NewHandler(repo, opts ...Option)`に可変長オプション`WithCardFormatter(f CardFormatter)`を足す。既存の`NewHandler(repo)`呼び出しは変えない。新ハンドラは`refined_handler.go`に分ける。
- `CardFormatter`は`Format(ctx, Draft) (RefinedCard, error)`。`aiformat.New(apiKey, model string, opts ...)`が実装し、SDKのベースURL・タイムアウトはテスト用に差し替えられる。
- `cmd/server/wiring.go`の`buildHandler`（`main.go`が呼ぶ）は、`ANTHROPIC_API_KEY`の前後の空白を取り除いた値が空でなければ`aiformat`を構築して注入し、空（空白だけを含む）ならオプションを渡さない。`ANTHROPIC_MODEL`も前後の空白を取り除き、空なら既定の`claude-haiku-5-5`を使う（nilのままで、新エンドポイントだけが503を返す）。この判定は`main`の外の小さな関数に切り出してテストする。鍵はログに出さない。
- `compose.yaml`のapiサービスへ`ANTHROPIC_API_KEY`と`ANTHROPIC_MODEL`を環境変数で渡す（未設定なら空）。`.env`はGit管理外のまま。`.env.example`には空の項目とコメントを足す（鍵の値は書かない）。
- Dockerfileは`go.sum`を使うため、依存追加後の`go.mod`と`go.sum`をコミットする。

## ドキュメント
README（エンドポイント表、ファイル構成、Goの環境変数の表。ホストで`go run`するときは`.env`を自動で読まないので`ANTHROPIC_API_KEY`を自分で渡す）、docs/api.md（使い方、curl例には`Content-Type`を付ける、エラー、料金、データ送信、再試行、認証が無いためAPIを公開ネットワークへ出さない注意（既定は`127.0.0.1`のみで公開）、暫定の上限、意味の保持の限界、実機確認の手順）、compose.yaml、.env.example、docs/verification.md（AI起票の節に、実施したことだけを書く。実機未確認は明示する）を同時に更新する。`scripts/smoke.py`は課金されるため新エンドポイントを呼ばない（その旨をverification.mdに書く）。

## 検証
- 実際のClaude APIの呼び出しは、鍵が無い環境では実行できない。テストはSDKのベースURLをローカルのテストサーバーへ向けて、リクエストの形（パス、鍵が認証ヘッダー（SDKが送る`Authorization: Bearer`または`X-Api-Key`）に載ること、`anthropic-version`が空でないこと、`model`、`max_tokens`、`output_config`のスキーマと`effort`、`temperature`/`top_p`/`top_k`/`thinking`を送らないこと、リトライ0回）と各種応答の扱いを検証する。SDKの型は、固定した版で実際にビルドして確かめる。
- 全失敗経路（401・429・500・529・接続失敗・タイムアウト・本文が止まる応答・refusal・`max_tokens`・不正JSON・未知キー・検証落ち）で、応答本文とログに、鍵・下書き・上流の本文の文字列（センチネル値）が出ないこと、DB（`memoryRepo`）にカードが増えないこと。
- `memoryRepo`が下書きを含むエラーを返したとき、応答本文とログに漏れないこと（列の解決とカード作成のどちらでも）。説明が空の下書きにAIが説明を返しても空で保存されること、説明のある下書きにAIが空を返したら502でカードが作られないこと。
- 429のとき上流を呼ばないこと、枠がリクエストの取り消しでも解放されること、鍵なしの配線で503になり鍵ありで動くこと、Todo列が無いときAIを呼ばず500になること、Content-Type違いが415になること。
- 実MySQLが使える環境では、偽のフォーマッターを使ってHTTP経由の起票がTodoのカードと`created`の履歴を作ることを確かめる。
- 実機の応答の確認は、鍵を設定した利用者が一度行う手順をdocs/api.mdに残す。確認済みとは書かない。

## 含まないこと
画面からの起票、複数カードの一括作成、AIによる列・PR URL・優先度の決定、AIの応答の保存・再利用、プロンプトキャッシュ、ストリーミング、認証・IP単位のレート制限・総額の上限、他社のAIサービス。

## 知見
L-017/L-031 鍵と下書きを例外・ログ・応答に出さない。L-027 全失敗経路で漏洩しないことをテストする。L-044 鍵未設定や未知の応答を黙ってフォールバックしない（503/502）。L-018 検証した値をそのまま保存する。L-054 本文の読み込みを含めた打ち切り（Goのコンテキストが本文の読み込みも覆う）。L-098 上位の待ち（15秒）が手順の最悪時間より長いことを確かめる。L-653 タイムアウト後の再試行による重複を文書で注意する。L-059/L-045 外部APIのモックだけでは実物を保証できないため、未検証の範囲を明記する。L-060 配線の漏れをテストする。L-028 鍵を含む設定ファイルがGitに入らないこと（`.env`は無視済み）。L-203 README・docs・compose・.env.exampleを同時に更新する。

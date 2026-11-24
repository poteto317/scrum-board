# コールドスタートを短くする（#122）設計

## 背景

本番は最小インスタンス数が 0 で、しばらく使わないと次のアクセスで起動し直す。起動のたびに、次の待ちが出る。

- `InitializeHistory`（`backend/internal/kanban/history_migration.go`）が、全アイテム（ゴミ箱を含む）を 1 件ずつ `baseline` に渡し、そのたびにトランザクション（`BEGIN`・行ロック付き SELECT・履歴の有無の SELECT・`COMMIT`）を張る。履歴が既にあっても省略しないので、アイテム数に比例して往復が増える。
- Cloud Run の起動確認（startup probe）が 5 秒間隔。アプリが 2 秒で起動しても、次の確認まで待つ。
- `deploy/entrypoint.sh` が、API の準備を 1 秒刻みで待つ。

## 決めたこと

- `InitializeHistory` は、先に「履歴が 1 件も無いアイテムの id」を 1 文で抽出し（`NOT EXISTS`）、その id にだけ `baseline` を呼ぶ。履歴が全件にある通常の起動では、トランザクションが 0 本になる。`baseline` は、トランザクション内で行ロックのうえ履歴の有無を再確認するので、並行して起動した別インスタンスとの競合でも基線は 1 件のままになる（動作は変えない）。
- 起動確認を `periodSeconds=1,failureThreshold=240,timeoutSeconds=1` にする。猶予の合計は従来と同じ 240 秒。Cloud Run は `timeoutSeconds` が `periodSeconds` 以下であることを要求するので、1 にする（TCP 接続の確認なので足りる）。
- entrypoint の待機を 0.2 秒刻み・600 回（合計 120 秒、従来と同じ）にする。
- `scripts/check-deploy-image-hardening.sh` に、上の 2 つの値を守る検査を足す。

## 受け入れ条件

1. 履歴が全アイテムにある状態で `InitializeHistory` を呼ぶと、トランザクションを開かない（MySQL の `Com_begin` が増えない。アイテム数に依らない）。
2. 履歴の無いアイテムだけが抽出され（id 順、ゴミ箱を含む。履歴のあるアイテムは含まれない）、基線がそのアイテムに 1 件だけ作られる。2 回呼んでも増えない。
3. 複数のインスタンスが同時に `InitializeHistory` を呼んでも、エラーにならず、基線は各アイテム 1 件のまま。
4. 既存の `TestMySQLHistory*` の結果が変わらない（`TestMySQLHistory`・`TestMySQLHistoryRecordsEachFieldWithBeforeAndAfter` は変更前から失敗しており、今回の変更とは無関係）。
5. `check-deploy-image-hardening.sh` が通り、起動確認の値と待機の刻みを検査する。

## 範囲外（別のカードにする）

- スキーマの版数を持ち、最新なら`main.go` の約 30 個の初期化（`Initialize*`）をまとめて飛ばす案。各初期化（`Initialize*`）が冪等であることに依存して毎回走らせている現状を変えるため、版数の上げ忘れで新しい初期化が黙って飛ばされる危険がある。版数の持ち方と、初期化を足すときの検査を含めて、別に設計する。
- 本番での起動時間の計測（デプロイ前後の比較）。

## 実装プラン

変更が小さいため、実装プランは作らず、設計書のサブエージェントレビューも省く。

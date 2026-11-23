# アイテムのプロジェクト別アーカイブ

## 背景

カード #111 は「Done になって10日経過したアイテムをアーカイブへ移動し、アーカイブはプロジェクトごとに作る」としている。既存のゴミ箱は `deleted_at` と専用一覧を使い、スケジューラから日次 API を呼び出すが、アーカイブは削除ではなく、内容を保持して通常の作業一覧から分離する機能とする。

カードにはコメントと関連アイテムがなく、ラベル情報はない。

## 決めたこと

| 事項 | 採用 |
|---|---|
| 保存モデル | `archived_at` でアーカイブを表し、削除や既存の Close 列とは分離する |
| Done 経過時間 | Done 列へ入った時刻を `done_at` に保存する。旧版で残った古い値は最新の Done status 遷移履歴の時刻と比較し、より新しい時刻を採用する |
| アーカイブ画面 | `/archive` の一覧を設け、ヘッダーメニューから開く。アクティブプロジェクトだけを表示する |
| アーカイブ解除 | 一覧または read-only 詳細から Done の末尾へ戻し、`done_at` を解除時刻へ更新して10日タイマーをリセットする |
| 自動実行 | 既存 Scheduler 認証を使う日次ジョブ。最大約24時間の遅延を許容する。ゴミ箱 purge との実行順には依存しない |
| 保持 | アーカイブは期限で削除しない。完全削除・ゴミ箱の既存動作は変更しない |
| Done の識別 | 大文字小文字を区別して `Done` と完全一致する列を使う（既存の完了列判定と同じ）。列名変更 UI は現在ない |
| 既存 Done アイテム | `changes` に `field='status'` を含む最新の `kind='updated'` 履歴が Done への遷移ならその日時を使う。履歴がない／created・baseline・imported 履歴しかない場合は migration 時点の `updated_at` を `done_at` に一度だけ設定する。日次処理では `updated_at` を使わない |
| タイムスタンプ | アプリケーションの UTC 時刻を使う。日次ジョブは同じ UTC 基準で判定する |
| 解除・削除 | アーカイブ解除は `archived_at` と `done_at` に加えて必要な並び順だけ更新する。ゴミ箱への削除・復元は `done_at` を保持し、削除期間も Done 経過時間に含める |

## 目的と受け入れ条件

1. アイテムが Done 列へ移動した時刻を記録する。Done 以外へ移動したら解除し、再度 Done へ移動したら時刻を更新する。Done 内の本文編集や並べ替えではタイマーをリセットしない。
2. 10×24時間ちょうどを含め、Done になって10×24時間以上の未削除アイテムをアーカイブする。通常の Done 状態を保つ。
3. アーカイブの一覧と操作はプロジェクト単位で分離する。あるプロジェクトの取得・解除・自動アーカイブが、別プロジェクトのアイテムを漏らしたり変更したりしない。
4. アーカイブされたアイテムはボード、バックログ、列内／バックログ並べ替えから除外する。スプリントの過去の割当・詳細と完了集計、既存の関連付けは保持し、Done の実績を失わない。スプリントからの割当追加・解除は解除前にアーカイブ解除を要求する。通常の詳細 GET は閲覧 ACL の範囲で読み取り専用表示を許可する。
5. `/archive` はアクティブプロジェクトの番号・タイトル・アーカイブ日時を表示し、既存の詳細 URL `/items/:number?project=:projectId` へ移動できる。プロジェクト切替時に一覧を読み直し、読込失敗を空一覧として扱わない。
6. アーカイブ一覧・read-only 詳細から解除できる。解除時に `archived_at` を消し、Done 列の末尾へ配置し、`done_at` を現在時刻に設定する。解除後は通常の一覧に戻り、10日後に再び自動アーカイブの対象になる。
7. 通常のアイテム API と解除 API は既存 ACL を守る。アーカイブ一覧は閲覧可能なアイテムだけを返し、閲覧不可・編集不可の応答は既存 ACL 規則に従う。自動アーカイブ API は既存の job runner policy（Scheduler token または管理者セッション）を使う。
8. 日次 Scheduler は `POST /api/archive/auto-archive` を呼び、再試行しても安全に同じ対象を処理する。処理は最大100件ずつ別トランザクションで繰り返し、各 batch は再試行可能にする。API は全 batch の処理件数を `{"archived": n}` で返す。スクリプトは既存 Scheduler 設定と同じリージョン・プロジェクト・トークンを使い、専用のジョブ名 `scrum-board-archive-auto` を持つ。
9. 既存アイテムのスキーマ移行は `done_at IS NULL` の現在 Done 行だけを更新し、再実行可能にする。`changes` に `field='status'` を含む最新の `kind='updated'` 履歴だけを status 遷移として扱い、baseline、created、`kind='restored'` imported は使わない。有効な Done 遷移履歴がない行は migration 実行時点の `updated_at` を一度だけ `done_at` に保存する。旧版が Done へ再遷移して古い `done_at` を残した場合は、日次処理が Done 遷移時刻と `done_at` の新しい方を使う。日次処理では `updated_at` にフォールバックしない。
10. ゴミ箱の soft delete / restore / purge、Close 操作、他のプロジェクトの列・順序に回帰がない。

## データと状態遷移

- `items.done_at DATETIME(6) NULL`: 現在 Done のアイテムが Done になった時刻。状態が Done 以外なら NULL。
- `items.archived_at DATETIME(6) NULL`: NULL は通常一覧、非 NULL はアーカイブ一覧。API DTO では `archivedAt` として返す。
- 自動対象は現在の Done 列にあり、`done_at` と最新 Done 遷移時刻（`kind='updated'` かつ `changes` に `field=status, after=Done` を含む履歴）の新しい方を実効時刻とする。両方 NULL の行は自動処理対象外として件数をログに記録し、日次処理で `updated_at` は使わない。実効時刻が `nowUTC - 10×24h` 以下、`deleted_at IS NULL`、`archived_at IS NULL` のアイテムに限定する。通常経路では `updated_at` の編集で `done_at` は変わらない。
- `done_at` は作成・詳細のステータス変更・ボードのドラッグ移動など、すべての列変更経路で同じ規則を使う。列内の位置変更や内容編集では変えない。
- 完了列は名前が大文字小文字を区別して正確に `Done` の列である。既存の完全一致 helper を再利用し、DB 側で比較する場合は binary comparison を使う。自動処理・status 遷移・既存スプリント集計でこの定義を揃える。
- アーカイブ中の通常詳細 GET と履歴・コメント・添付・AI chat・item command template の読み取りは ACL を適用して許可する。通常詳細は読み取り専用とし、解除導線を表示する。
- アーカイブ中はアイテムの PATCH（本文・status・assignee・project・favorite・ACL 等）、DELETE、コメント POST/PATCH/DELETE、添付 POST/DELETE、AI chat POST/DELETE、item command template PUT、並べ替えを拒否する。削除するには先にアーカイブ解除する。
- `PATCH /api/items/{id}` に集約された favorite / related item 変更を含む、既存アイテムに対する全書込経路で archived 状態を拒否する。新規作成と、既存 archived item を対象にしない recurring rule の管理・run、sprint metadata 操作は通常どおり許可する。trash restore / purge は deleted item のみを扱い、archived item には適用しない。
- bulk command template 適用はアーカイブ済みを対象外にする。過去のスプリント割当と完了は維持する。`activate` / `complete` / velocity 集計はアーカイブ済みの Done アイテムも含める。アーカイブ済みアイテムの sprint 割当追加・解除は拒否し、解除前の操作を要求する。全件置換では現在の archived membership を維持する。
- `deleted_at` と `archived_at` は同時に立てない。解除は本文・コメント等を変更せず、active な Done アイテムの末尾へ新しい `position` を採番し、`archived_at` / `done_at` だけを更新する。ゴミ箱への削除・復元は `done_at` を保持する。trash restore は既存の列復元規則を保ち、復元先が Done なら保持した `done_at` を使い、存在する非Done列ならその列へ戻して `done_at` をクリアする。復元先列が削除済みの場合は既存規則どおり Todo へ戻し、`done_at` をクリアする。
- 自動アーカイブと解除は `item_history` に `archivedAt` の変更として記録する。履歴の `occurred_at` は同じ UTC の操作時刻とし、既存 status history の意味は変えない。解除後は `done_at` が履歴上の古い Done 遷移時刻より新しいため、10日間の再アーカイブ猶予を保証する。
- 初期スキーマを `database/init/001_schema.sql` と起動時マイグレーションの両方に反映し、`idx_items_project_archived (project_id, archived_at, id)` と `idx_items_done_archived_deleted (done_at, archived_at, deleted_at)` を追加する。起動時 migration は既存の履歴 baseline 作成より前に実行し、初回 baseline の現在時刻で業務遷移時刻を汚染しない。

## API

| 操作 | 方法 | 挙動 |
|---|---|---|
| 一覧 | `GET /api/archive?projectId=` | 指定プロジェクトのアーカイブ済みアイテムを `archived_at DESC, id DESC` で返す。閲覧 ACL を適用する |
| 解除 | `POST /api/items/{id}/unarchive?projectId=` | 対象プロジェクトのアーカイブ済みアイテムだけ解除。`archived_at=NULL, done_at=now` とし Done 列末尾へ配置。通常アイテムと同じ編集 ACL。未存在・別プロジェクト・未アーカイブは 404 |
| 自動アーカイブ | `POST /api/archive/auto-archive` | `requireJobRunnerAuth`（Scheduler token または管理者セッション）。session-exempt route に登録し、明示的 guard を必ず通す。全プロジェクトを対象に最大100件ずつ別トランザクションで処理し、`{"archived": n}` を返す |

API の projectId 解決規則・番号と内部 ID の扱いは既存アイテム API に合わせる。ブラウザーは ProjectSession の `projectId` を常に明示する。省略時は既存 item API と同じ active project 解決、別プロジェクト・未存在・状態不一致は 404 とする。解除では対象の存在・project scope を先に検証し、別プロジェクト・未存在は 404、対象プロジェクト内の権限不足は既存 `requireEdit` の ACL 応答を使う。

## UI

- `/archive` を認証必須の専用一覧にする。番号、タイトル、アーカイブ日時、既存詳細 URL へのリンク、解除ボタンを表示する。詳細は `archivedAt` がある間読み取り専用となる。
- ヘッダーメニューに「アーカイブ」を追加し、ボード／バックログ／アイテム詳細から開けるようにする。`PageKind` と既存設定の読み込み・保存規則を壊さない。
- 現在の `ProjectSession` とプロジェクト切替の世代ガードを利用し、切替後に古い一覧や解除応答で新しいプロジェクトを汚さない。
- アーカイブ解除は処理中の多重実行を防ぎ、失敗理由を表示する。成功時に対象を一覧から除外する。詳細画面では編集・削除を無効化し、解除導線を表示する。
- 既存のゴミ箱画面・削除ダイアログをアーカイブ画面に流用して意味を混同しない。

## 自動実行・権限

- 既存の `requireJobRunnerAuth` を自動アーカイブ API に適用し、Scheduler token または管理者セッションを許可する。ルートを `sessionExempt` に登録したうえで、明示的な job runner guard を必ず通す。
- `scripts/ensure-archive-scheduler.sh` を追加し、既存 trash purge Scheduler の設定を踏襲する。必須環境変数は `GCP_PROJECT` / `SCHEDULER_JOB_TOKEN` / `PUBLIC_ORIGIN`、既定 region は `asia-northeast1`、既定のジョブ名は `scrum-board-archive-auto`、時刻は03:30 Asia/Tokyo とする。trash purge との順序依存は設けない。
- `scripts/deploy-gcp.sh` に設定コマンドを案内する。デプロイ時に環境の Scheduler を勝手に作成・更新しない。
- API の一覧、詳細、解除、自動処理の各経路で project scope と ACL をサーバ側で検証する。上記の全書込経路を拒否し、bulk / sprint 経路はアーカイブ済みメンバーを特別扱いする。
- `docs/openapi.yaml`、`docs/api.md`、`scripts/check-openapi-routes.py` と `scripts/check-no-gcp-project-fallback.sh` を更新する。

## テスト方針

- DB／メモリ実装で Done への遷移・離脱・再入場、編集・列内並べ替えでの維持を検証する。
- 自動処理は期限の1マイクロ秒前、ちょうど10日、期限後、Done 以外、削除済み、既アーカイブ、別プロジェクト、古い `done_at` を持つ旧版の再遷移を検証する。同時実行・再試行では `archived_at IS NULL` の条件付き更新と `RowsAffected == 1` の時だけ履歴を書くことを確認する。
- 100件を超える対象を複数 batch transaction で処理し、全件数を正しく返して二重履歴を作らないことを検証する。
- アーカイブ一覧・ボード／バックログ・列内／バックログの並べ替えと再採番からの除外を検証する。Done 列にアーカイブ済みがある時も通常カードの並べ替えは成功する。詳細は読み取り専用、スプリント実績・割当・関連表示は維持し、データを消さない。
- 解除は正しいプロジェクト・ACLのみ成功し、10日タイマーの再設定と通常一覧への復帰を検証する。未アーカイブ・他プロジェクトは 404。
- Scheduler token / 管理者セッションの許可と未認証・一般ユーザーの拒否、Content-Type / Origin 検証、session-exempt route、プロジェクト切替時の表示、一覧読込失敗、解除失敗、アーカイブ中の各書込拒否をテストする。
- 既存 Done のマイグレーションで、最新の `updated` status 履歴（`changes` 配列の `field=status`, `after=Done`。created は除外）、baseline/imported の除外、`updated_at` フォールバック、旧アプリの再遷移を日次処理で修復、マイグレーション再実行を検証する。
- アーカイブ解除から直後・期限直前・ちょうど10日後の日次処理、および Done のまま本文編集しても解除時刻を維持することを検証する。
- ゴミ箱の削除期間も Done 経過時間に含まれ、Done 列へ復元した直後に期限超過なら日次処理が対象とすることを検証する。
- Sprint の割当追加・解除拒否、全件置換で archived membership を保持、`activate` / `complete` / velocity が Done の実績を維持することを検証する。
- status 列名が Done 以外の場合は自動アーカイブせず、他列のデータを変更しないことを検証する。

## 非対象

- アーカイブの自動削除・保持期限・ゴミ箱への自動移動。
- Done 以外の列に対する自動アーカイブや、任意列・日数の設定 UI。
- アーカイブ中の編集・並べ替え・削除・コメント追加（読み取りは許可し、編集・削除前に解除する）。
- 複数アイテムの一括解除。
- 環境への Cloud Scheduler の作成・実行（スクリプト整備まで）。

## 注意する知見

- L-002: 一覧取得の失敗を空として扱わない。
- L-015: アーカイブ・解除で要求外の既存属性を暗黙に書き換えない。
- L-843: 一覧・更新・並べ替えをプロジェクト境界で必ず絞る。
- L-901: 主 API だけでなく関連・派生一覧・操作 API にも ACL を適用する。
- L-464: 日次ジョブは再試行・重複実行を前提に冪等にする。
- L-626: 一般の `updated_at` を Done という業務イベント時刻の代用にせず、遷移時刻を別に保存する。

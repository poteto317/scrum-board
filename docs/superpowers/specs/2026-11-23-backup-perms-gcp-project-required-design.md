# #109 バックアップ権限と GCP_PROJECT 必須化 — 設計

## 背景

かんばんカード [#109](https://scrum-board-jkcejsb6ka-an.a.run.app/items/109?project=1):

- 手元の `.env` と `backups/` の SQL ダンプが権限 644
- README のバックアップ手順に権限指定がない
- `scripts/deploy-gcp.sh` / `scripts/ensure-*.sh` と README の GCP プロジェクト既定値が実プロジェクト ID（`daily-routine-app-8a832`）

影響: 同一端末の他ユーザーや同期ツールがダンプを読める。`GCP_PROJECT` 未指定のままデプロイすると本番へ向かう。

## 決めたこと

| 項目 | 決定 |
| --- | --- |
| バックアップ手順 | README の **明示コードブロック 2 箇所**（ローカル更新前バックアップ例、および「本番へのデータ移行」§1）の両方に、`mkdir` の前へ `umask 077` を書く。「同様に」参照だけの節は、参照先が umask 付きになれば足りる |
| 既存ダンプ | 作業ツリーの `backups/*.sql` は移行用途の手元残渣とみなし **すべて削除**する（現状 1 ファイル）。Git 未追跡のため PR 差分には出ない。完了証跡は実装ログ／手動確認（`ls backups` が空またはディレクトリ無し） |
| `.env` | Git 管理外。実装時に手元 `.env` を `chmod 600`。README に「手元の `.env` は `chmod 600` を推奨」を 1 行。受け入れの数値条件には含めない（正本は umask / GCP_PROJECT） |
| `.env.example` | **本カードでは触らない**（コメントの例示 ID は「例」でありスクリプト既定ではない） |
| `GCP_PROJECT` | 次の 3 スクリプトから `${GCP_PROJECT:-daily-routine-app-8a832}` を撤去し、未設定または空なら既存 `require` で非 0 終了: `deploy-gcp.sh` / `ensure-trash-purge-scheduler.sh` / `ensure-recurring-run-scheduler.sh`。空白のみは本カードでは追加検証しない（既存 `require` のまま）。`GCP_REGION` 等の非プロジェクト固有既定は維持 |
| README の GCP 言及 | **本番デプロイ関連**（「前提」の課金プロジェクト説明、初回 `export` 例、deploy-gcp 前後の `export GCP_PROJECT=...`）を、「必ず自分のプロジェクト ID を `export` する。スクリプトに本番既定は無い」に揃える。実 ID を「既定」「上書き可」と書かない。サンプルは `export GCP_PROJECT=YOUR_GCP_PROJECT_ID` のようなプレースホルダ |
| 回帰防止ガード | **同一 PR 必須**（#103/#104 と同型の付帯）。`scripts/check-no-gcp-project-fallback.sh` を追加し `secret-scan.yml` の deploy-guards から呼ぶ。検査対象は **3 スクリプト内の `GCP_PROJECT:-…本番ID` フォールバックのみ**。README / `.env.example` / `docs/production-deploy-status.md` 等の文字列は禁止しない |
| ensure コメント | 両 `ensure-*.sh` 先頭の「Optional overrides: GCP_PROJECT」を、必須である旨に直す |
| スコープ外 | Secret Manager・Cloud Run 権限・ルート `.dockerignore`（L-1004 系の別経路）、バックアップ暗号化、CI からの本番デプロイ禁止、`.env.example` / `docs/production-deploy-status.md` の書き換え |

## 現状

1. `require GCP_PROJECT` はあるが、その直前に `GCP_PROJECT="${GCP_PROJECT:-daily-routine-app-8a832}"` があるため未設定でも通る。
2. `backups/` と `.env` は `.gitignore` / `.dockerignore` 済み。権限は OS 任せ。
3. README バックアップ例は `mkdir -p backups` → リダイレクトのみ（2 箇所）。

## アプローチ（採用）

ドキュメント＋シェル既定の撤去（最小差分）。バックアップ専用スクリプトは新設しない。

## 受け入れ条件

1. README のバックアップ例 2 箇所に `umask 077` があり、その手順で作った新規ダンプが所有者以外に読めない（`ls -l` で group/other に r が無い）
2. 実装時点で作業ツリーの `backups/*.sql` が存在しない（手動確認）
3. `GCP_PROJECT` 未設定（unset）で 3 スクリプトが即非 0 終了し、stderr に `GCP_PROJECT` を含む
4. 3 スクリプトに `GCP_PROJECT:-daily-routine-app-8a832`（または同プロジェクト ID のフォールバック）が無いことをガードが検出する
5. README の本番デプロイ関連節が「未設定でもそのプロジェクトへ行く」読みを誘わない

## 非目標

- OpenAPI / アプリ本体の変更
- 本番 Cloud Run の再デプロイ必須化

## 知見

- L-1004: 本カードは Secret Manager 平文 env 問題とは独立。触るのは「デプロイ先プロジェクトの暗黙既定」とローカルダンプ権限のみ
- L-001: フォールバック撤去後、`GCP_PROJECT` unset を成功扱いにしない（受け入れ3＝`require` の非 0）。空白のみは既存 `require` のままスコープ外

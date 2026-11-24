# カード133: web-devの依存インストール省略

## 目的
依存が同じweb-dev再起動はnpm ciを省き、ng serveを開始する。空ボリューム・lockやmanifest変更・Node/npm/CPU変更・不完全な依存はnpm ciで回復する。稼働中コンテナと共有ボリュームを検証で変更しない。

## 方式の比較・決定
起動スクリプトで成功マーカーとnpmの依存整合性を確認する方式を採用する。node_modulesの存在だけでは途中失敗や依存変更を検出できない。開発イメージへの依存の焼き込みはソースマウント構成を大きく変えるため採用しない。
- frontend/scripts/start-docker.mjsをNodeで実行し、npm run start:dockerへ接続する。composeの既存node_modulesボリュームを維持する。
- 成功マーカーはnode_modules/.web-dev-install.json。package.jsonとpackage-lock.jsonのSHA256、Node version/platform/arch、npm --version、node_modules/.package-lock.jsonのSHA256を記録する。マーカーなし・壊れ・不一致は再インストール。
- マーカー一致時でもnpm ls --all --parseableの成功を確認し、欠落/不正な依存なら再インストールする。全ファイルの改変検査は行わない（npmのメタデータと依存ツリーの整合性を扱う）。
- npm ciの前に古いマーカーを除去し、成功かつ依存ツリー確認後だけ書く。失敗時はサーバーを起動せず非ゼロで終了する。依存が同じ再起動ではciの実行回数が増えないことをテストする。
- Node親プロセスはインストールを含む全npm子プロセスのプロセスグループへSIGINT/SIGTERMを転送し、終了コードを反映する。停止要求を受けたら後続の処理を実行せず、途中のインストールを成功マーカーに記録しない。並行して同じボリュームに書く複数のweb-dev起動は対象外（Compose既存単一サービス運用）。
- start:dockerの--pollは2000から1000へ変更する。CPU負荷は環境依存で固定値を保証しない。本番ビルド・通常のnpm startは変更しない。

## 検証・知見
Node標準node:testで一時fixtureを実行し、初回ci・同じ再起動スキップ・各キー変更・依存欠落・インストール失敗/マーカー破損・サーバー終了コード/シグナル転送を検証する。実npmのローカル依存fixtureでも初回と再起動、依存欠落を確認する。専用Dockerコンテナでホスト用node_modulesと混同せず起動を確認する。compose configでは秘密を出力しない。
L-001: 失敗後はサーバーを起動しない。L-289: fixture/子プロセスを必ず後始末。L-195: Linuxコンテナで実起動を確かめる。

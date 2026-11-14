# Docker Compose 開発用画面（web-dev / 自動反映）設計書

## 目的と対象

ローカルで Compose を使っているとき、静的配信の `web`（Nginx がビルド成果物を配信）ではソース保存が画面にすぐ反映されない。**同じ `:4200` で `ng serve` による開発用画面を起動し、CSS / HTML / TS の保存をブラウザーへ自動反映する**。

対象はローカル開発の起動経路のみ。本番相当の Compose 既定経路（`web`）、アプリ本体の機能、API・DB の契約は変えない。

## 背景（決めたこと）

ユーザーが「ローカル :4200 が更新されない。変更を自動反映したい」と依頼し、次の案から **A を採用**した。

| 案 | 内容 | 判断 |
| --- | --- | --- |
| **A（採用）** | Compose に `profiles: ["dev"]` の `web-dev`（`ng serve`）を追加し、`web` の代わりに同じポートで起動 | Docker 完結・既存ホスト開発手順も残せる |
| B | ホストで `npm start` のみ案内を強化 | すでに README にあるが、Compose 利用者の痛みは残る |
| C | ソース変更のたびに `web` イメージを再ビルド | 反映が遅く、開発体験として不適切 |

## 設計判断

### 1. サービス分離と profile

- **既定**（`docker compose up`）: 従来どおり `db` / `api` / `web`。`web-dev` は起動しない。
- **開発**（`--profile dev`）: `web-dev` を追加起動できる。イメージは公式 `node:24-alpine`（フロントの Dockerfile を流用せず、ホストの `./frontend` をマウントして `ng serve`）。
- `web` と `web-dev` はどちらも `127.0.0.1:${WEB_PORT:-4200}` を使うため、**同時起動はしない**。ヘルパーは先に `web` を止めてから `web-dev` を上げる。

### 2. プロキシ（L-760）

- ホスト開発: 既存の `proxy.conf.json` → `http://127.0.0.1:8080`（変更しない）。
- コンテナ内 `web-dev`: 新規 `proxy.docker.json` → `http://api:8080`。`npm` スクリプト `start:docker` が `--proxy-config proxy.docker.json` を付ける。
- 検証はブラウザーを開く前に、公開ポート経由で `curl` が `/api/...` の JSON を返すことを確認する。

### 3. ファイル監視

- Docker Desktop / ボリューム越しの変更検知のため、`CHOKIDAR_USEPOLLING` と `ng serve --poll 2000` を使う（`@angular/build` 利用のため webpack 向けの `WATCHPACK_POLLING` は使わない）。
- `node_modules` は名前付きボリューム `frontend_node_modules` に分離し、ホスト側の `node_modules` と混線しない。

### 4. 起動ヘルパーとドキュメント（L-072 / L-591）

- `scripts/dev-web.sh`: リポジトリルートへ `cd` したうえで `web` 停止 → `db` / `api` / `web-dev` 起動。利用者の設定ファイルを上書き・削除しない。`down -v` 等の破壊的コマンドは書かない。
- README の既存「コードを編集しながら開発する」節を更新し、Docker 推奨経路を先頭に、ホスト経路をその下に置く（新章だけに例外を書かない）。

### 5. 範囲外（YAGNI）

- Angular / Node のメジャーアップグレード、ホットリロード以外の開発ツール追加、CI への `web-dev` 組み込み、本番イメージへの `ng serve` 混入は行わない。
- かんばんアプリの機能変更・API 変更は行わない。

## 構成

```
browser :4200
    → web-dev (ng serve, profile=dev)
         /api → proxy.docker.json → api:8080
         静的・live-reload → ./frontend マウント

既定:
browser :4200 → web (nginx) → /api は nginx 設定経由で api
```

## 受け入れ条件

1. `./scripts/dev-web.sh`（または同等の compose コマンド）後、http://localhost:4200 でかんばんが表示される。
2. `frontend` の CSS/TS を保存すると、`ng serve` の live-reload（スタイルは既定の HMR）により手動リロードなしで画面に反映される。
3. 公開ポート経由の `/api/board`（または同等）が JSON を返す（HTML フォールバックにならない）。
4. `docker compose up -d`（profile なし）では従来どおり `web` のみが画面を提供し、`web-dev` は起動しない。
5. ホストの `npm start` + `proxy.conf.json` 経路は引き続き動作する説明が README に残る。

## 検証方針（L-059）

- ユニットテスト追加は必須としない（Compose / 起動経路の変更が主）。
- 実機: `dev-web.sh` → curl `/api/...` → ブラウザーでボード表示 → CSS 1 行変更の反映確認。
- 回帰: `cd frontend && npm test -- --watch=false` と `npm run build` が通ること（アプリコード未変更でも確認）。

## 知見の反映

- **L-048**: 既存の `npm start` / `proxy.conf.json` / Compose `web` の動作を前提に、置き換えではなく並行経路を追加する。
- **L-059**: モックだけでなく実 Compose で受け入れを確認する。
- **L-072**: 手順・スクリプトは利用者設定を消さず、作業ディレクトリをリポジトリルートに固定する。
- **L-591**: README の既存開発節を更新し、古い説明だけが残らないようにする。
- **L-760**: コンテナ起動は必ず `proxy.docker.json` 付き。検証で `/api` が JSON であることを確認する。

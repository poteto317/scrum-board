# カード132 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 各タスクを順に実行する。

**Goal:** ビルド段のエミュレーションを避け、依存レイヤーとコンパイルキャッシュを再利用する。
**Architecture:** BuildKitのBUILDPLATFORM/TARGETOS/TARGETARCHとcache mountを既存Dockerfileに追加する。最終段はターゲットCPUで維持する。
**Tech Stack:** Docker BuildKit/buildx、Go、npm/Angular
**Spec:** docs/superpowers/specs/2026-11-25-card132-build-cache-design.md

## Global Constraints
既存のdigest pin、非rootユーザー・権限、ルート.dockerignore、SHA/latestタグとpush順、linux/amd64のCloud Runを維持する。実サービスへのデプロイは実行しない。依存やベースイメージの更新は含めない。

## Review Focus
ホストarm64でamd64を指定してもビルドツールがarm64で動く。
Goの出力は対象CPUに一致し、backendは未指定時のarm64も動く。
依存取得とビルドの両方でGoモジュールcache mountを使う（片方だけでは隠れる）。
ソース変更で依存取得レイヤーが再実行されず、Goの未変更パッケージのコンパイルを再利用する。
キャッシュはGCされうるため、キャッシュなしでも正しい成果物を作れる。

## Task 1: 本番ビルド（実装・検証を同じ責務としてコミット）
Files: deploy/Dockerfile, scripts/deploy-gcp.sh, README.md
- [x] 現行Dockerfileを確認し、BUILDPLATFORMとcache mountが無い現状を記録する。Docker buildxが動作することを確認する。
- [x] fe-build/api-buildのFROMに--platform=$BUILDPLATFORMを指定する。api-buildにARG TARGETOS/TARGETARCHを追加し、go buildへCGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCHを渡す。
- [x] npm ciに/root/.npm、go mod downloadとgo buildに/go/pkg/mod、go buildに/root/.cache/go-buildをcache mountする。構文ディレクティブは現在のBuildKit組込み構文で足りるので追加しない。
- [x] デプロイスクリプトをdocker buildx build --load --platform linux/amd64に変更し、READMEへBuildKit/buildx前提・キャッシュ再利用条件を記載する。
- [x] `docker buildx build --load --platform linux/amd64 -f deploy/Dockerfile -t scrum-board-card132:verify .` を実行し成功を確認する。実行コンテナを起動せずdocker create/cpで/serverを一時ディレクトリへ取り出しfileでELF x86-64を確認、作成コンテナは削除する。
- [x] 一時コンテキスト（git管理ファイルと未コミットDockerfileをコピー、秘密・node_modules除外）でGoソース末尾にコメントだけ追加して再ビルドする。go mod download/npm ciがCACHED、go buildが再実行されることをログで確認する。
- [x] 一時の診断用Dockerfileでfe-buildにnode -p process.arch、api-buildにgo env GOHOSTARCHを挿入し、--platform linux/amd64でも両方arm64と出ることを確認する。
- [x] 診断用Dockerfileでgo build -xを使い、ウォーム再ビルドのcompile呼び出しが初回より減り、未変更依存の再コンパイルをしないことを確認する。検証用ファイルは/tmpと.claude/dev-flow配下に置く。既存キャッシュは削除しない。

## Task 2: backend単体ビルド（独立コミット）
Files: backend/Dockerfile
- [x] build段をBUILDPLATFORMにし、Task1と同じTARGETOS/TARGETARCHとGoモジュール・ビルドキャッシュを適用する。ランタイム段は変更しない。
- [x] `docker buildx build --load --platform linux/amd64 -t scrum-board-card132:backend-amd64 backend` と `docker buildx build --load -t scrum-board-card132:backend-native backend` を実行し、/serverのELFが順にx86-64とaarch64になることを確認する。

## Task 3: ガードとレビュー
- [x] README記載のデプロイガード8本、対応する既存selftest、bash -n scripts/deploy-gcp.shを実行する。検証結果をこのプラン末尾へ記録する。
- [x] git diff --checkとfeatureレビューゲートを通し、SRP・コード・PRレビューへ自動連結する。設計・計画はドキュメントの責務として別コミットにする。

知見: L-195実環境の実測、L-064一時コンテキストの再ビルド、L-340責務単位で独立ビルド。

## 検証結果（2026-11-25）
- Apple SiliconのDocker Desktop/BuildKitで本番linux/amd64、backend指定amd64、backend既定arm64をすべてビルド成功。
- 本番とbackend-amd64の/serverはELF x86-64、backend既定はELF aarch64。検査用コンテナは起動せず削除済み。
- Node process.archとGo GOHOSTARCHはarm64。最終ランタイムと生成物は指定ターゲットを維持。
- 一時コンテキストでmain.goにコメントを追加して再ビルド。npm ciとgo mod downloadはCACHED、go build -xのcompileはmainの1件のみで依存パッケージのcompileは0件。
- 初回Goビルド175.7秒。並行した補助ビルドを途中で中断して直列化したため、厳密な速度比較値としては扱わない。実測ログは.claude/dev-flow/card132-*.logに保存。
- README記載のデプロイガード8本と既存selftest5種、bash構文、git diff --check成功。本番サービスへのデプロイは未実行。

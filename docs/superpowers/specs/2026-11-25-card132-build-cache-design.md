# カード132: 本番ビルドのネイティブ実行とキャッシュ

## 目的・完了条件
Apple SiliconでもnpmとGoのビルド段をBUILDPLATFORMで動かす。本番はlinux/amd64を維持し、GoはTARGETOS/TARGETARCHを明示してクロスコンパイルする。ソースだけ変更した再ビルドでは依存取得レイヤーとGoの未変更パッケージのコンパイルキャッシュを再利用する。変更したパッケージとリンクは再実行するため、完全な再コンパイルゼロや時間の固定値は保証しない。

## 方式と決定
BuildKitの自動プラットフォーム引数とcache mountを使う。エミュレーションの継続は待ち時間を改善しない。リモートキャッシュやCI移行は今回の範囲を超えるため採用しない。
- deploy/Dockerfileのfe-build/api-build、backend/DockerfileのbuildをFROM --platform=$BUILDPLATFORMにする。最終段はターゲットプラットフォームのまま維持する。
- Go段でARG TARGETOS/TARGETARCHを宣言しCGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCHでビルドする。backendの既定arm64も維持し、amd64をハードコードしない。
- npm ciに/root/.npm、go mod downloadとgo build両方に/go/pkg/mod、go buildに/root/.cache/go-buildのcache mountを追加する。依存マニフェスト→依存取得→ソースCOPYの順を維持。Goのキャッシュはツール側のキーでバージョン・対象アーキテクチャを区別する。
- scripts/deploy-gcp.shはbuildx build --loadを使い、linux/amd64指定とSHA/latestの2タグ、後続pushを維持する。BuildKit/buildxを前提としてREADMEに記載する。
- 既存のルート.dockerignore、digest pin、実行ユーザー、権限、認証、Cloud Run設定を維持する。稼働サービスへのデプロイは行わない。

## 検証
Dockerで本番とbackendをそれぞれ--platform linux/amd64でビルドし、生成/serverのELFマシンがx86-64であることを確認。backendはプラットフォーム未指定のビルドでもホスト既定のarm64成果物になることを確認する。ビルド段のプラットフォームはBuildKitのチェック/ログで確認する。ソースコメントだけを変更した一時コンテキストで再ビルドし、依存レイヤーがCACHEDであることを確認する。Goのキャッシュマウントはbuild -xの診断用実行で既存パッケージのcompile実行が省かれることを確認する。新たなビルドキャッシュやローカル検証用イメージはGCで消えうる通常の開発資源として扱い、既存キャッシュを削除しない。
既存のデプロイガード一式（README記載）と構文検証を実行する。

## 知見・参照
L-195: ローカルDockerで実ビルドと生成物を確認する。L-064: 一時コンテキストでソース変更後の成果物を確かめる。L-340: 本番Dockerfile/デプロイとbackend Dockerfileを、それぞれ検証込みの責務でコミットする。
Docker公式: https://docs.docker.com/build/building/multi-platform/ 、https://docs.docker.com/build/cache/optimize/ 。

# ルート `.dockerignore`（#104）

## 背景

`scripts/deploy-gcp.sh` はリポジトリルートをビルドコンテキストにして `docker build -f deploy/Dockerfile .` を実行する。ルートに `.dockerignore` が無いため、`frontend/node_modules`・`frontend/dist`・`frontend/.angular`・`.env`・`backups/`・`.git`・`.claude` などが Docker デーモンへ送られる。`frontend/.dockerignore` はコンテキストが `frontend/` のときだけ効き、この本番ビルドでは無効。

## 受け入れ条件

- ルートに `.dockerignore` がある。
- 本番ビルドの入力として、少なくとも次がコンテキストから除外される: `node_modules`、`dist`、`.angular`、`.env*`、`backups`、`.git`、`.claude`。
- `deploy/Dockerfile` が必要とするパス（`frontend/package.json`、`frontend/package-lock.json`、`backend/go.mod`、`backend/go.sum`、`deploy/nginx.conf`、`deploy/entrypoint.sh`）を除外する行を置かない。誤除外の検知はチェックスクリプトの「禁止パターン」検査で行う（実 `docker build` は必須としない）。
- `frontend/Dockerfile` / `backend/` 向けの既存 `.dockerignore` は残し、ルート追加で壊さない。
- 回帰防止のため、同 PR で `scripts/check-root-dockerignore.sh` を追加し、`.github/workflows/secret-scan.yml` から呼ぶ（完了の中核はルート `.dockerignore`。チェック＋CI は #103 hardening と同じ運用で必須とする）。

## 決めたこと

| 事項 | 採用 | 理由 |
|------|------|------|
| 手段 | ルート `.dockerignore` のみ追加 | チケットの直し方そのもの。Dockerfile の COPY 列挙やビルドコンテキスト分割は範囲外 |
| パターン粒度 | **先頭スラッシュ無し**のディレクトリ名（`node_modules` 等）＋明示パス（`.git`、`backups`、`.claude`、`.env*`）。`/node_modules` のようなルート限定形は禁止 | Docker の ignore は先頭 `/` でコンテキスト直下のみになる。`frontend/node_modules` も除外するためスラッシュ無しが必須 |
| `.env.example` | `.env*` に含めて除外してよい | 本番イメージビルドに不要。L-336 は git 追跡の話であり dockerignore では問題にならない |
| `frontend/.dockerignore` | 維持 | `frontend/Dockerfile`（コンテキスト=`frontend/`）用。ルート追加と役割が違う |
| Dockerfile 変更 | しない | COPY パスはそのままで、コンテキスト側を絞る |
| 検証 | `scripts/check-root-dockerignore.sh` + CI 配線 | Docker デーモン無しで必須行・禁止行を検査。任意の実コンテキスト確認は手元のみ |

## 非目標

- Cloud Build への移行、リモートビルダー設定の変更。
- `compose.yaml` や `frontend/Dockerfile` のコンテキスト設計の見直し。
- `.gitignore` の変更（既に同種の除外がある）。

## 除外パターン（必須）

各行はトリム後の**完全一致**で存在する（順不同。空行・`#` コメントは無視。追記行は可）。先頭 `/` 付きの同名パターン（例 `/node_modules`）は置かない。

```
node_modules
dist
.angular
.env*
backups
.git
.claude
```

任意の追加（AC 外。置いてもよいがチェック必須ではない）:

```
.superpowers
.worktrees
.DS_Store
backend/server
```

## 検証方針

1. `scripts/check-root-dockerignore.sh`
   - ルート `.dockerignore` が存在する。
   - 必須 7 パターンが行完全一致で含まれる（上記）。
   - 禁止: 必須と同名の先頭 `/` 付き行、必要パスを落とす行（`frontend`、`frontend/`、`frontend/*`、`backend`、`backend/`、`backend/*`、`deploy`、`deploy/`、`deploy/*`、`frontend/package.json`、`frontend/package-lock.json`、`backend/go.mod`、`backend/go.sum`、`deploy/nginx.conf`、`deploy/entrypoint.sh`）、およびコンテキスト全体を落とす行（`*`、`**`、`**/*`）。`!` 再包含は使わない（必須除外と衝突しやすいため本変更では禁止）。
2. `.github/workflows/secret-scan.yml`（hardening と同ジョブ）から `bash -n` とスクリプト実行を呼ぶ。
3. 手動（任意・非 AC）: Docker がある環境でコンテキストに `frontend/node_modules` / `.env` が乗らないことを確認してよい。

## 知見（手順 4）

- L-028: 秘密ファイルがビルド入力に乗らないようルート ignore で塞ぐ
- L-064: 手元の `dist` / 古い成果物がビルドに混ざらないようにする
- L-336: `.env*` は dockerignore では見本も含めて除外してよい（git とは別）
- L-1004: 本変更は Secret Manager とは独立。コンテキスト漏洩の別経路を閉じる

## レビュー記録

### 第 1 周（記述の確かさ）

- [対応] AC の「必要パスを除外しない」が検証と未接続 → 禁止パターン検査と明記
- [対応] 先頭 `/` 付きパターンの危険 → 禁止と明記
- [対応] CI 配線が表だけ → secret-scan ジョブへ追加を AC 化
- [対応] 必須行の照合規則未定義 → 完全一致・順不同・コメント無視を固定

### 第 2 周（範囲と知見）

- [対応] 推奨 4 行を AC 外の任意に格下げ
- [対応] `*` / `**` / `!` 再包含を禁止リストへ追加
- [対応] チェック＋CI はチケット文言より広いが #103 と同運用で必須と明記（中核は `.dockerignore`）

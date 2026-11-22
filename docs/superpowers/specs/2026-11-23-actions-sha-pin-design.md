# GitHub Actions SHA 固定（#106）

## 背景

`.github/workflows/secret-scan.yml` が `actions/checkout@v4` と `gitleaks/gitleaks-action@v2` を可変タグで参照している。タグ差し替え時に任意コードが `contents: read` 権限で実行されるリスクがある（影響は限定）。

## 受け入れ条件

- `secret-scan.yml` の **すべての `uses:`** が `owner/repo@<40桁の hex コミット SHA>` 形式である（`# v4` など行末コメントは任意）。
- 同 PR で **`.github/dependabot.yml`** を追加し、`package-ecosystem: github-actions` で週次更新する。
- 同 PR で **`scripts/check-workflow-action-pins.sh`** を追加し、`.github/workflows/secret-scan.yml` の `uses:` 行について **full commit SHA 以外を拒否**する（`@v4`・`@main`・ブランチ・短縮 SHA・semver タグを含む）。
- `secret-scan.yml` の `deploy-guards` ジョブから、既存 3 本と同様に `bash -n`・スクリプト実行・（新ガードのみ）`--selftest` を呼ぶ。README の deploy-guards 説明を **4 本**に更新する。
- ローカルで既存 3 本＋新ガードを順に実行できること（#104 プランと同型）。

## 決めたこと

| 事項 | 採用 | 理由 |
|------|------|------|
| SHA 解決 | 実装時に `gh api repos/{owner}/{repo}/git/refs/tags/{ref}` の `object.sha`（`v4` / `v2`） | 移動タグが指すコミットを固定。CI ではネットワーク検証しない |
| 表記 | `actions/checkout@<sha> # v4` | 可読性。Dependabot が SHA のみ更新してもコメントは手動更新可（必須ではない） |
| checkout 2 箇所 | **同一 SHA** を使う | 現状どおり同一リビジョン |
| Dependabot | `directory: /`、`schedule: weekly` | チケットの「更新は Dependabot に任せる」 |
| ガード対象 | `secret-scan.yml` の `uses:` 行のみ | 本リポに workflow は 1 本のみ |

初期ピン（実装時記録）:

| Action | ref | commit SHA |
|--------|-----|------------|
| `actions/checkout` | `v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `gitleaks/gitleaks-action` | `v2` | `dcedce43c6f43de0b836d1fe38946645c9c638dc` |

## 非目標

- 他リポジトリ workflow、composite action、gitleaks ルール本文の変更。
- CI 上での `gh api` によるリモート SHA 一致検証。

## 検証方針

1. `scripts/check-workflow-action-pins.sh` — `uses:` が `^[[:space:]]*- uses: [^@]+@[0-9a-f]{40}` に一致すること。`@` 以降が 40 桁以外なら失敗。
2. `--selftest` — 一時ディレクトリに合格 YAML と `@v4` を含む不合格 YAML を置き、期待どおり exit 0 / 非 0 になること。
3. `deploy-guards` から `bash -n`、本体実行、`--selftest`（新ガードのみ追加。`check-root-dockerignore` の selftest は現状維持）。

## 知見（手順 4）

- **L-1040**: ビルド／デプロイ入力の不変参照と同様、CI のサードパーティ Action も **コミット SHA** で固定する（#103 のイメージ digest 固定と横並び）。

## レビュー記録

設計レビューは `review-log.md` の `feature-spec` 第 1・2 周を参照。
# htpasswd 標準入力化（#105）実装プラン

**Goal:** `entrypoint.sh` でパスワードを引数に載せず bcrypt の `.htpasswd` を生成する。

**Spec:** `docs/superpowers/specs/2026-11-22-htpasswd-stdin-design.md`

## タスク

- [x] **Step 1:** `deploy/entrypoint.sh` — `umask 077`、`htpasswd -i -B -C 10 -c`、`chown`/`chmod`
- [x] **Step 2:** `scripts/check-deploy-image-hardening.sh` — `-b` 禁止、`htpasswd -i` / `-B` / `chmod 640` 必須
- [x] **Step 3:** ガード実行（`bash -n` + 本体）

## 受け入れ

- 起動時コマンドラインに平文パスワードが無い（コード上 `-b` 無し）。
- CI の deploy-guards が回帰を検知する。
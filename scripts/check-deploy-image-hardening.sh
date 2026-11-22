#!/usr/bin/env bash
# Fail if production image hardening regresses (#103).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DF="$ROOT/deploy/Dockerfile"
EP="$ROOT/deploy/entrypoint.sh"
DEPLOY="$ROOT/scripts/deploy-gcp.sh"

fail() {
  echo "check-deploy-image-hardening: $1" >&2
  exit 1
}

assert_grep() {
  local pattern="$1" file="$2" label="$3"
  local use_fixed="${4:-}"
  if [[ "$use_fixed" == fixed ]]; then
  if ! grep -qF -- "$pattern" "$file"; then
    fail "missing ${label} in ${file}"
  fi
  else
  if ! grep -qE "$pattern" "$file"; then
    fail "missing ${label} in ${file}"
  fi
  fi
}

digest_count="$(grep -cE '^FROM .+@sha256:' "$DF" || true)"
if [[ "$digest_count" -ne 3 ]]; then
  fail "expected 3 digest-pinned FROM lines in deploy/Dockerfile, got ${digest_count}"
fi

assert_grep 'adduser -S app' "$DF" 'non-root app user'
assert_grep 'chown root:app /server && chmod 550 /server' "$DF" 'server binary permissions'
assert_grep "su -s /bin/sh app -c 'exec /server'" "$EP" 'non-root API start'
assert_grep 'curl -sf' "$EP" 'curl readiness probe'
assert_grep 'status --porcelain' "$DEPLOY" 'clean working tree before deploy'
assert_grep 'IMAGE_TAG="\$\(git -C "\$ROOT" rev-parse HEAD\)"' "$DEPLOY" 'git SHA image tag'
assert_grep 'docker push "$IMAGE_URI"' "$DEPLOY" 'push SHA-tagged image' fixed
assert_grep 'docker push "$IMAGE_URI_LATEST"' "$DEPLOY" 'optional latest alias push' fixed
assert_grep '--image="$IMAGE_URI"' "$DEPLOY" 'Cloud Run deploys SHA tag' fixed

echo "ok: deploy image hardening (non-root API, digest, SHA tag)"
#!/usr/bin/env bash
# Fail if production image hardening regresses (#103).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DF="$ROOT/deploy/Dockerfile"
EP="$ROOT/deploy/entrypoint.sh"
DEPLOY="$ROOT/scripts/deploy-gcp.sh"

grep -q '@sha256:' "$DF"
grep -q 'adduser -S app' "$DF"
grep -q 'chown app:app /server' "$DF"
grep -q "su -s /bin/sh app -c 'exec /server'" "$EP"
grep -q 'curl -sf' "$EP"
grep -q 'IMAGE_TAG="$(git -C "$ROOT" rev-parse HEAD)"' "$DEPLOY"
grep -q 'docker push "$IMAGE_URI_LATEST"' "$DEPLOY"
echo "ok: deploy image hardening (non-root API, digest, SHA tag)"
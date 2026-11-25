#!/usr/bin/env bash
# Smoke: optional ANTHROPIC arrays under bash 3.2 + set -u, and deploy-gcp.sh contracts.
# Usage: ./scripts/check-deploy-anthropic-optional.sh [--selftest]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/scripts/deploy-gcp.sh"
BASH_BIN="${BASH_BIN:-/bin/bash}"

usage() {
  cat <<'EOF'
Usage: ./scripts/check-deploy-anthropic-optional.sh [--selftest]
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --selftest|"") ;;
  *) usage >&2; exit 1 ;;
esac

[ -f "$DEPLOY" ] || { echo "error: missing $DEPLOY" >&2; exit 1; }

# deploy-gcp.sh contracts (grep body; avoid duplicating SET_SECRETS assembly).
grep -Fq 'SECRET_ID_ANTHROPIC_API_KEY=' "$DEPLOY" || {
  echo "error: deploy-gcp.sh missing SECRET_ID_ANTHROPIC_API_KEY" >&2
  exit 1
}
grep -Fq 'OPT_SECRET_ENV=()' "$DEPLOY" || {
  echo "error: deploy-gcp.sh missing OPT_SECRET_ENV array" >&2
  exit 1
}
grep -Fq 'ACCESSOR_SECRETS=("${REQ_SECRET_ID[@]}")' "$DEPLOY" || {
  echo "error: deploy-gcp.sh missing safe ACCESSOR_SECRETS init" >&2
  exit 1
}
if grep -Fq 'ACCESSOR_SECRETS=("${REQ_SECRET_ID[@]}" "${OPT_SECRET_ID[@]}")' "$DEPLOY"; then
  echo "error: deploy-gcp.sh still concatenates empty OPT under set -u" >&2
  exit 1
fi
# Must not write ANTHROPIC into ENV_VARS_FILE block (non-secret yaml).
if awk '
  /ENV_VARS_FILE=.*mktemp/ { inblock=1 }
  inblock && /\} >"\$ENV_VARS_FILE"/ { inblock=0 }
  inblock && /ANTHROPIC_API_KEY/ { found=1 }
  END { exit found ? 0 : 1 }
' "$DEPLOY"; then
  echo "error: ANTHROPIC_API_KEY must not appear in ENV_VARS_FILE generation" >&2
  exit 1
fi

# bash 3.2 + set -u: empty OPT append must not unbound (mirrors deploy ACCESSOR pattern only).
"$BASH_BIN" -c '
set -euo pipefail
REQ_SECRET_ID=(id-db id-auth id-admin id-sched)
OPT_SECRET_ID=()
ACCESSOR_SECRETS=("${REQ_SECRET_ID[@]}")
if [[ "${#OPT_SECRET_ID[@]}" -gt 0 ]]; then
  ACCESSOR_SECRETS+=("${OPT_SECRET_ID[@]}")
fi
[[ "${#ACCESSOR_SECRETS[@]}" -eq 4 ]]
OPT_SECRET_ID=(id-anthropic)
ACCESSOR_SECRETS=("${REQ_SECRET_ID[@]}")
if [[ "${#OPT_SECRET_ID[@]}" -gt 0 ]]; then
  ACCESSOR_SECRETS+=("${OPT_SECRET_ID[@]}")
fi
[[ "${#ACCESSOR_SECRETS[@]}" -eq 5 ]]
'

echo "ok: check-deploy-anthropic-optional"

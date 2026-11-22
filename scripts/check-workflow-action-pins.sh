#!/usr/bin/env bash
# Fail if secret-scan workflow uses mutable action refs (#106).
# Usage: ./scripts/check-workflow-action-pins.sh [--selftest]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="${WORKFLOW_ACTION_PINS_FILE:-$ROOT/.github/workflows/secret-scan.yml}"

fail() {
  echo "check-workflow-action-pins: $1" >&2
  exit 1
}

check_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "missing $path"

  local line_num=0
  local line
  local uses_count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_num=$((line_num + 1))
    if ! grep -qE '^[[:space:]]*-[[:space:]]+uses:' <<<"$line"; then
      continue
    fi
    uses_count=$((uses_count + 1))
    if ! grep -qE '^[[:space:]]*-[[:space:]]+uses:[[:space:]]+[^@[:space:]]+@[0-9a-f]{40}([[:space:]]|#|$)' <<<"$line"; then
      fail "line ${line_num}: uses must pin full commit SHA (owner/repo@40hex): ${line}"
    fi
  done < "$path"

  if [[ "$path" == *secret-scan.yml ]]; then
    [[ "$uses_count" -eq 3 ]] || fail "expected 3 pinned uses in $path, got ${uses_count}"
    grep -qF 'gitleaks/gitleaks-action@' "$path" || fail "missing gitleaks/gitleaks-action pin in $path"
    grep -qF 'actions/checkout@' "$path" || fail "missing actions/checkout pin in $path"
  fi
}

expect_fail() {
  local path="$1"
  local label="$2"
  if ( check_file "$path" ); then
    fail "selftest expected failure ($label)"
  fi
}

run_selftest() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  local good="$tmp/good.yml"
  local bad="$tmp/bad.yml"
  cat >"$good" <<'EOF'
jobs:
  x:
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: gitleaks/gitleaks-action@dcedce43c6f43de0b836d1fe38946645c9c638dc # v2
EOF
  cat >"$bad" <<'EOF'
jobs:
  x:
    steps:
      - uses: actions/checkout@v4
EOF

  check_file "$good"
  expect_fail "$bad" "mutable @v4 ref"
  echo "ok: selftest"
}

if [[ "${1:-}" == "--selftest" ]]; then
  run_selftest
  exit 0
fi

check_file "$WORKFLOW"
echo "ok: workflow action pins"
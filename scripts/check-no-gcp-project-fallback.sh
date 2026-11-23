#!/usr/bin/env bash
# Fail if deploy/ensure scripts embed a default GCP_PROJECT (production ID fallback).
# Usage: ./scripts/check-no-gcp-project-fallback.sh [--selftest]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TARGETS=(
  "$ROOT/scripts/deploy-gcp.sh"
  "$ROOT/scripts/ensure-trash-purge-scheduler.sh"
  "$ROOT/scripts/ensure-recurring-run-scheduler.sh"
)

# Any GCP_PROJECT assignment / parameter-expansion default that hard-codes the prod project id.
PATTERN='GCP_PROJECT=.*daily-routine-app-8a832|\$\{GCP_PROJECT:[-:=]daily-routine-app-8a832\}'

has_fallback() {
  local f
  for f in "$@"; do
    if grep -E -q "$PATTERN" "$f"; then
      return 0
    fi
  done
  return 1
}

if [[ "${1:-}" == "--selftest" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  printf '%s\n' 'GCP_PROJECT="${GCP_PROJECT:-daily-routine-app-8a832}"' >"$tmp"
  if ! has_fallback "$tmp"; then
    echo "error: selftest expected detection of :- fallback line" >&2
    exit 1
  fi
  printf '%s\n' 'GCP_PROJECT="${GCP_PROJECT:=daily-routine-app-8a832}"' >"$tmp"
  if ! has_fallback "$tmp"; then
    echo "error: selftest expected detection of := fallback line" >&2
    exit 1
  fi
  echo "ok: selftest detected synthetic GCP_PROJECT fallbacks"
  exit 0
fi

found=0
for f in "${TARGETS[@]}"; do
  if has_fallback "$f"; then
    echo "error: $f still has GCP_PROJECT production fallback default" >&2
    found=1
  fi
done
if [[ "$found" -ne 0 ]]; then
  exit 1
fi
echo "ok: no GCP_PROJECT production fallback in deploy/ensure scripts"

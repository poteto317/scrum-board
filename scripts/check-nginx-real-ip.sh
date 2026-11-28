#!/usr/bin/env bash
# Fail if deploy/nginx.conf stops restoring the client IP behind Cloud Run's front end (#171).
# Usage: ./scripts/check-nginx-real-ip.sh [--selftest] [-h|--help]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
目的: deploy/nginx.conf が Cloud Run の前段（169.254.0.0/16）だけを信頼して
      X-Forwarded-For から利用者の IP を復元すること（realip）を検証する。
      - set_real_ip_from は 169.254.0.0/16 の 1 行だけ（広げると偽の XFF を信じる）
      - real_ip_header X-Forwarded-For; と real_ip_recursive on; がそれぞれ 1 行だけ
        （location などで上書きすると、その経路だけ前段の IP に戻り全員が 1 つのキーを共有する）
      - 3 つとも最初の server ブロックより前（http レベル）にあり、全 location に効く
使い方:
  ./scripts/check-nginx-real-ip.sh
  ./scripts/check-nginx-real-ip.sh --selftest
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --selftest|"") ;;
  *) usage >&2; exit 1 ;;
esac

check_conf() {
  local conf="$1" label="$2"
  [ -f "$conf" ] || { echo "error: missing $label ($conf)" >&2; return 1; }
  local froms
  froms="$(grep -E '^[[:space:]]*set_real_ip_from[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*set_real_ip_from[[:space:]]+([^;[:space:]]+).*/\1/' || true)"
  [ "$froms" = "169.254.0.0/16" ] || {
    echo "error: $label set_real_ip_from must be exactly 169.254.0.0/16 (got: ${froms:-none})" >&2; return 1
  }
  local headers recursives
  headers="$(grep -E '^[[:space:]]*real_ip_header[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*//' || true)"
  [ "$headers" = "real_ip_header X-Forwarded-For;" ] || {
    echo "error: $label must have exactly one 'real_ip_header X-Forwarded-For;' (got: ${headers:-none})" >&2; return 1
  }
  recursives="$(grep -E '^[[:space:]]*real_ip_recursive[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*//' || true)"
  [ "$recursives" = "real_ip_recursive on;" ] || {
    echo "error: $label must have exactly one 'real_ip_recursive on;' (got: ${recursives:-none})" >&2; return 1
  }
  # All three must be at http level (before the first server block) so every location uses them.
  local first_server last_realip
  first_server="$(grep -nE '^[[:space:]]*server[[:space:]]*\{' "$conf" | head -n1 | cut -d: -f1 || true)"
  last_realip="$(grep -nE '^[[:space:]]*(set_real_ip_from|real_ip_header|real_ip_recursive)[[:space:]]' "$conf" | tail -n1 | cut -d: -f1 || true)"
  if [ -n "$first_server" ] && [ "$last_realip" -gt "$first_server" ]; then
    echo "error: $label realip directive at line $last_realip must be before the first server block at line $first_server (http level)" >&2; return 1
  fi
  return 0
}

expect_fail() {
  local name="$1" body="$2" t
  t="$(mktemp)"
  printf '%s\n' "$body" >"$t"
  if check_conf "$t" "$name" 2>/dev/null; then
    rm -f "$t"; echo "error: --selftest expected failure: $name" >&2; exit 1
  fi
  rm -f "$t"
}

if [[ "${1:-}" == "--selftest" ]]; then
  ok='set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  printf '%s\n' "$ok" >"$tmp"
  check_conf "$tmp" "selftest-complete" || { echo "error: --selftest expected success" >&2; exit 1; }
  expect_fail "missing-from" 'real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "trust-all" 'set_real_ip_from 0.0.0.0/0;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "extra-from" 'set_real_ip_from 169.254.0.0/16;
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "wrong-header" 'set_real_ip_from 169.254.0.0/16;
real_ip_header X-Real-IP;
real_ip_recursive on;'
  expect_fail "location-override" 'set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
server {
  location = /api/auth/login {
    real_ip_header X-Real-IP;
    real_ip_recursive off;
  }
}'
  expect_fail "inside-server" 'server {
  set_real_ip_from 169.254.0.0/16;
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;
}'
  expect_fail "recursive-off" 'set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive off;'
  echo "ok: check-nginx-real-ip --selftest"
  exit 0
fi

check_conf "$ROOT/deploy/nginx.conf" "deploy/nginx.conf"
echo "ok: deploy/nginx.conf restores client IP via realip (169.254.0.0/16 only)"

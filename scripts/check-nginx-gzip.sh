#!/usr/bin/env bash
# Fail if deploy/frontend nginx.conf lose gzip settings or /api/ proxy buffers (#113).
# Usage: ./scripts/check-nginx-gzip.sh [--selftest] [-h|--help]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
目的: deploy/nginx.conf と frontend/nginx.conf の gzip と location /api/ の
      proxy_buffers 契約を検証する。
使い方:
  ./scripts/check-nginx-gzip.sh
  ./scripts/check-nginx-gzip.sh --selftest
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --selftest|"") ;;
  *) usage >&2; exit 1 ;;
esac

TYPES=(
  text/plain
  text/css
  text/xml
  application/json
  application/javascript
  text/javascript
  application/xml
  image/svg+xml
)

api_location_body() {
  local conf="$1"
  awk '
    /^[[:space:]]*location[[:space:]]+\/api\// {
      if ($0 ~ /location[[:space:]]*=/) next
      in_api=1
      depth=0
    }
    in_api {
      print
      for (i=1; i<=length($0); i++) {
        c=substr($0,i,1)
        if (c=="{") depth++
        if (c=="}") {
          depth--
          if (depth<=0) { in_api=0; exit }
        }
      }
    }
  ' "$conf"
}

check_conf() {
  local conf="$1"
  local label="$2"
  [ -f "$conf" ] || { echo "error: missing $label ($conf)" >&2; return 1; }

  grep -qE '^[[:space:]]*gzip[[:space:]]+on;' "$conf" || {
    echo "error: $label missing 'gzip on;'" >&2; return 1
  }
  grep -qE '^[[:space:]]*gzip_proxied[[:space:]]+any;' "$conf" || {
    echo "error: $label missing 'gzip_proxied any;'" >&2; return 1
  }
  grep -qE '^[[:space:]]*gzip_vary[[:space:]]+on;' "$conf" || {
    echo "error: $label missing 'gzip_vary on;'" >&2; return 1
  }
  grep -qE '^[[:space:]]*gzip_min_length[[:space:]]+256;' "$conf" || {
    echo "error: $label missing 'gzip_min_length 256;'" >&2; return 1
  }
  grep -qE '^[[:space:]]*gzip_comp_level[[:space:]]+5;' "$conf" || {
    echo "error: $label missing 'gzip_comp_level 5;'" >&2; return 1
  }

  local t
  for t in "${TYPES[@]}"; do
    grep -qF "$t" "$conf" || {
      echo "error: $label gzip_types missing $t" >&2; return 1
    }
  done

  local body
  body="$(api_location_body "$conf")"
  [ -n "$body" ] || {
    echo "error: $label missing location /api/ block" >&2; return 1
  }
  echo "$body" | grep -qE 'proxy_buffering[[:space:]]+on;' || {
    echo "error: $label location /api/ missing proxy_buffering on;" >&2; return 1
  }
  echo "$body" | grep -qE 'proxy_buffer_size[[:space:]]+128k;' || {
    echo "error: $label location /api/ missing proxy_buffer_size 128k;" >&2; return 1
  }
  echo "$body" | grep -qE 'proxy_buffers[[:space:]]+8[[:space:]]+256k;' || {
    echo "error: $label location /api/ missing proxy_buffers 8 256k;" >&2; return 1
  }
  echo "$body" | grep -qE 'proxy_busy_buffers_size[[:space:]]+512k;' || {
    echo "error: $label location /api/ missing proxy_busy_buffers_size 512k;" >&2; return 1
  }
  return 0
}

if [[ "${1:-}" == "--selftest" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  cat >"$tmp" <<'EOF'
server {
  gzip on;
  gzip_comp_level 5;
  gzip_min_length 256;
  gzip_vary on;
  gzip_types text/css application/json;
  location = /api/auth/login {
    proxy_pass http://127.0.0.1:1;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:1;
  }
}
EOF
  if check_conf "$tmp" "selftest-incomplete"; then
    echo "error: --selftest expected failure when gzip_proxied/types/buffers incomplete" >&2
    exit 1
  fi
  cat >"$tmp" <<'EOF'
server {
  gzip on;
  gzip_comp_level 5;
  gzip_min_length 256;
  gzip_vary on;
  gzip_proxied any;
  gzip_types
    text/plain text/css text/xml application/json
    application/javascript text/javascript application/xml image/svg+xml;
  location = /api/auth/login {
    proxy_pass http://127.0.0.1:1;
  }
  location /api/ {
    proxy_pass http://127.0.0.1:1;
    proxy_buffering on;
    proxy_buffer_size 128k;
    proxy_buffers 8 256k;
    proxy_busy_buffers_size 512k;
  }
}
EOF
  if ! check_conf "$tmp" "selftest-complete"; then
    echo "error: --selftest expected success on complete fixture" >&2
    exit 1
  fi
  echo "ok: check-nginx-gzip --selftest"
  exit 0
fi

check_conf "$ROOT/deploy/nginx.conf" "deploy/nginx.conf"
check_conf "$ROOT/frontend/nginx.conf" "frontend/nginx.conf"
echo "ok: nginx gzip and /api/ proxy buffers (deploy + frontend)"

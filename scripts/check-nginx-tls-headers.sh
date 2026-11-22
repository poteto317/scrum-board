#!/usr/bin/env bash
# Fail if deploy/nginx.conf loses X-Forwarded-Proto passthrough, HSTS (#94), or CSP (#102).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/deploy/nginx.conf"

grep -q 'map \$http_x_forwarded_proto \$forwarded_proto' "$CONF"
grep -q 'proxy_set_header X-Forwarded-Proto \$forwarded_proto' "$CONF"
grep -q 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' "$CONF"
grep -q 'server_tokens off;' "$CONF"
grep -q "frame-ancestors 'none'" "$CONF"
grep -q 'add_header Content-Security-Policy' "$CONF"
# Edge Basic on UI only; /api must not require it (mobile Safari drops Authorization on XHR).
grep -q 'location /api/' "$CONF"
awk '
  /location = \/api\/auth\/login/,/^    \}/ { if ($0 ~ /auth_basic off/) login_off=1 }
  /location \/api\//,/^    \}/ { if ($0 ~ /auth_basic off/) api_off=1 }
  END { exit (login_off && api_off) ? 0 : 1 }
' "$CONF" || {
  echo "error: auth_basic off required in /api/auth/login and /api/ locations" >&2
  exit 1
}
if grep -q 'proxy_set_header X-Forwarded-Proto \$scheme' "$CONF"; then
  echo "error: proxy_set_header X-Forwarded-Proto \$scheme must not appear (use \$forwarded_proto)" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
PORT=8080 envsubst '${PORT}' < "$CONF" > "$tmp"
grep -q 'map \$http_x_forwarded_proto \$forwarded_proto' "$tmp"
grep -q 'proxy_set_header X-Forwarded-Proto \$forwarded_proto' "$tmp"
grep -q 'Strict-Transport-Security' "$tmp"
grep -q 'server_tokens off' "$tmp"
grep -q 'Content-Security-Policy' "$tmp"
echo "ok: nginx Forwarded-Proto passthrough + HSTS + CSP"

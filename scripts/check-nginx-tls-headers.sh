#!/usr/bin/env bash
# Fail if deploy/nginx.conf loses X-Forwarded-Proto passthrough or HSTS (item #94).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/deploy/nginx.conf"

grep -q 'map \$http_x_forwarded_proto \$forwarded_proto' "$CONF"
grep -q 'proxy_set_header X-Forwarded-Proto \$forwarded_proto' "$CONF"
grep -q 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' "$CONF"
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
echo "ok: nginx Forwarded-Proto passthrough + HSTS"

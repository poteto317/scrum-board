#!/bin/sh
set -eu

require_nonempty() {
    eval "val=\${$1:-}"
    if [ -z "$val" ]; then
        echo "error: $1 must be set and non-empty" >&2
        exit 1
    fi
}

require_nonempty AUTH_USER
require_nonempty AUTH_PASSWORD
require_nonempty PUBLIC_ORIGIN

case "$PUBLIC_ORIGIN" in
    http://*|https://*) ;;
    *)
        echo "error: PUBLIC_ORIGIN must start with http:// or https://" >&2
        exit 1
        ;;
esac

case "$PUBLIC_ORIGIN" in
    http://placeholder.invalid|http://placeholder.invalid/*|https://placeholder.invalid|https://placeholder.invalid/*)
        echo "error: PUBLIC_ORIGIN must not use host placeholder.invalid (set the real service URL)" >&2
        exit 1
        ;;
esac

htpasswd -bc /etc/nginx/.htpasswd "$AUTH_USER" "$AUTH_PASSWORD"

export LISTEN_ADDRESS=127.0.0.1:8081
export PORT="${PORT:-8080}"

su -s /bin/sh app -c 'exec /server' &
api_pid=$!

# Migrations (e.g. per-project numbering ALTER/renumber) can take well over a few seconds.
# Match server migration budget (~2m) so the probe does not kill a healthy still-migrating API.
i=0
while [ "$i" -lt 120 ]; do
    if curl -sf -o /dev/null http://127.0.0.1:8081/api/public-config 2>/dev/null; then
        break
    fi
    if ! kill -0 "$api_pid" 2>/dev/null; then
        wait "$api_pid" || true
        echo "error: API process exited before becoming ready" >&2
        exit 1
    fi
    i=$((i + 1))
    sleep 1
done

if ! curl -sf -o /dev/null http://127.0.0.1:8081/api/public-config 2>/dev/null; then
    echo "error: API did not become ready on /api/public-config" >&2
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    exit 1
fi

envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
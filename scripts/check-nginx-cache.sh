#!/usr/bin/env bash
# Fail if deploy/frontend nginx.conf lose the static-file Cache-Control contract (#121).
# Usage: ./scripts/check-nginx-cache.sh [--selftest] [-h|--help]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'USAGE'
目的: deploy/nginx.conf と frontend/nginx.conf の静的ファイルのキャッシュ指定を検証する。
  - map $uri $static_cache_control が次の順に並ぶ: 既定 no-cache、^/api/ は空、js/mjs/css は immutable
    (^/api/ を js の規則より後ろに置くと /api/x.js に immutable が付く)
  - add_header Cache-Control $static_cache_control が server 直下にあり、always が付かない。
    location の中には add_header を置かない（server 直下の nosniff・CSP・HSTS が継承されなくなる）
  - 存在しない js/mjs/css は try_files $uri =404 で 404 にする
使い方:
  ./scripts/check-nginx-cache.sh
  ./scripts/check-nginx-cache.sh --selftest
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --selftest|"") ;;
  *) usage >&2; exit 1 ;;
esac

check_conf() {
  local conf="$1" label="$2" body
  [ -f "$conf" ] || { echo "error: missing $label ($conf)" >&2; return 1; }
  # Comment lines are dropped so a commented-out line cannot satisfy a check.
  body="$(sed 's/^[[:space:]]*#.*//' "$conf")"

  # map: check the three rules appear in this order (step counts how many were seen).
  # The map must hold, in this order: no-cache default, empty /api/, immutable js/css.
  echo "$body" | awk '
    /map[[:space:]]+\$uri[[:space:]]+\$static_cache_control[[:space:]]*\{/ { in_map=1; next }
    in_map && /\}/ { in_map=0 }
    in_map && /default[[:space:]]+"no-cache";/ && step==0 { step=1; next }
    in_map && /\^\/api\/[[:space:]]+"";/ && step==1 { step=2; next }
    in_map && step==2 && $0 ~ /^[[:space:]]*~\*\\\.\(\?:js\|mjs\|css\)\$[[:space:]]+"public, max-age=31536000, immutable";[[:space:]]*$/ { step=3 }
    END { exit step==3 ? 0 : 1 }
  ' || {
    echo "error: $label map \$uri \$static_cache_control must list, in order: default \"no-cache\"; ^/api/ \"\"; js|mjs|css immutable" >&2; return 1
  }

  # add_header must sit directly in server{} (depth 1): inside a location it would
  # reset the inherited nosniff/CSP/HSTS. "always" would cache a 404 for a year.
  # add_header: track brace depth; the cache header only at server level, never inside a location.
  echo "$body" | awk '
    { line=$0
      if (line ~ /add_header/) {
        if (depth >= 2) bad_nested=1
        if (line ~ /add_header[[:space:]]+Cache-Control[[:space:]]+\$static_cache_control;/) ok=1
        if (line ~ /add_header[[:space:]]+Cache-Control/ && line ~ /always/) bad_always=1
      }
      opens=gsub(/\{/, "{", line); depth+=opens
      closes=gsub(/\}/, "}", line); depth-=closes
    }
    END { exit (ok && !bad_nested && !bad_always) ? 0 : 1 }
  ' || {
    echo "error: $label needs 'add_header Cache-Control \$static_cache_control;' (no always) directly in server{}, and no add_header inside any location" >&2; return 1
  }

  # location: the js/mjs/css block must answer missing files with 404.
  echo "$body" | awk '
    /location[[:space:]]+~\*[[:space:]]+\^\/\(\?!api\/\)\.\+\\\.\(\?:js\|mjs\|css\)\$[[:space:]]*\{/ { in_loc=1; next }
    in_loc && /try_files[[:space:]]+\$uri[[:space:]]+=404;/ { ok=1 }
    in_loc && /\}/ { in_loc=0 }
    END { exit ok ? 0 : 1 }
  ' || {
    echo "error: $label js/mjs/css location (excluding /api/) must use 'try_files \$uri =404;'" >&2; return 1
  }
  return 0
}

if [[ "${1:-}" == "--selftest" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp" "$tmp.b"' EXIT
  cat >"$tmp" <<'CONF'
map $uri $static_cache_control {
    default                   "no-cache";
    ~^/api/                   "";
    ~*\.(?:js|mjs|css)$       "public, max-age=31536000, immutable";
}
server {
    add_header Cache-Control $static_cache_control;
    location ~* ^/(?!api/).+\.(?:js|mjs|css)$ {
        try_files $uri =404;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
CONF
  check_conf "$tmp" "selftest-complete" || { echo "error: --selftest expected success" >&2; exit 1; }
  expect_fail() { # name, sed-expression
    sed "$2" "$tmp" > "$tmp.b"
    if check_conf "$tmp.b" "selftest-$1" 2>/dev/null; then
      rm -f "$tmp.b"; echo "error: --selftest expected failure: $1" >&2; exit 1
    fi
  }
  expect_fail no-404 's/=404/\/index.html/'
  expect_fail always 's/Cache-Control \$static_cache_control;/Cache-Control $static_cache_control always;/'
  expect_fail cacheable-default 's/"no-cache"/"public"/'
  expect_fail no-immutable 's/, immutable//'
  expect_fail js-extension-changed '/map/,/^}/ s/js|mjs|css/png/'
  expect_fail js-anchor-dropped '/map/,/^}/ s/css)\$/css)/'
  expect_fail js-case-sensitive '/map/,/^}/ s/~\*/~/'
  expect_fail api-not-excluded '/\^\/api\//d'
  expect_fail commented-default 's/^\(    default .*\)$/    # \1/'
  # add_header moved into a location (awk, not sed: BSD sed has no \n in replacements)
  awk '/^    add_header /{next} /^    location \/ \{/{print; print "        add_header Cache-Control $static_cache_control;"; next} {print}' "$tmp" > "$tmp.b"
  if check_conf "$tmp.b" "selftest-add-header-in-location" 2>/dev/null; then echo "error: --selftest expected failure: add-header-in-location" >&2; exit 1; fi
  # api rule after the js rule: /api/x.js would get immutable
  awk '/\^\/api\//{h=$0;next} {print} /immutable/{print h}' "$tmp" > "$tmp.b"
  if check_conf "$tmp.b" "selftest-api-after-js" 2>/dev/null; then rm -f "$tmp.b"; echo "error: --selftest expected failure: api-after-js" >&2; exit 1; fi
  rm -f "$tmp.b"
  echo "ok: check-nginx-cache --selftest"
  exit 0
fi

check_conf "$ROOT/deploy/nginx.conf" "deploy/nginx.conf"
check_conf "$ROOT/frontend/nginx.conf" "frontend/nginx.conf"
echo "ok: nginx static Cache-Control + 404 for missing bundles (deploy + frontend)"

#!/usr/bin/env bash
# Fail if root .dockerignore regresses (#104).
# Usage: ./scripts/check-root-dockerignore.sh [--selftest]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERIGNORE_FILE="${ROOT_DOCKERIGNORE:-$ROOT/.dockerignore}"

# Single source of required patterns (also used by --selftest fixtures).
REQUIRED_PATTERNS=(
  node_modules
  dist
  .angular
  '.env*'
  backups
  .git
  .claude
)

fail() {
  echo "check-root-dockerignore: $1" >&2
  exit 1
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

write_required_fixture() {
  local path="$1"
  local p
  : > "$path"
  for p in "${REQUIRED_PATTERNS[@]}"; do
    printf '%s\n' "$p" >> "$path"
  done
}

# Validate one dockerignore file. Exits non-zero via fail() on error.
check_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "missing $path"

  local lines=()
  local raw trimmed
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    trimmed="$(trim "$raw")"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    lines+=("$trimmed")
  done < "$path"

  local req found line bad
  for req in "${REQUIRED_PATTERNS[@]}"; do
    found=0
    for line in "${lines[@]}"; do
      if [[ "$line" == "$req" ]]; then
        found=1
        break
      fi
    done
    [[ "$found" -eq 1 ]] || fail "missing required pattern: $req"
  done

  # Forbidden: leading-slash variants of required names, whole-context globs,
  # and paths that would break deploy/Dockerfile COPY (frontend|backend|deploy).
  for bad in \
    /node_modules /dist /.angular '/.env*' /backups /.git /.claude \
    '*' '**' '**/*' \
    frontend 'frontend/' 'frontend/*' backend 'backend/' 'backend/*' deploy 'deploy/' 'deploy/*' \
    frontend/package.json frontend/package-lock.json backend/go.mod backend/go.sum \
    deploy/nginx.conf deploy/entrypoint.sh
  do
    for line in "${lines[@]}"; do
      [[ "$line" == "$bad" ]] && fail "forbidden pattern: $bad"
    done
  done

  for line in "${lines[@]}"; do
    case "$line" in
      !*) fail "negation not allowed: $line" ;;
    esac
  done
}

expect_fail() {
  local path="$1"
  local label="$2"
  if ( check_file "$path" ); then
    fail "selftest expected failure ($label)"
  fi
}

run_selftest() {
  local tmpdir
  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/dockerignore-selftest.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmpdir'" EXIT

  local good="$tmpdir/good"
  write_required_fixture "$good"
  check_file "$good"

  local missing="$tmpdir/missing"
  grep -v '^node_modules$' "$good" > "$missing"
  expect_fail "$missing" "missing required"

  local slash="$tmpdir/slash"
  {
    cat "$good"
    echo '/node_modules'
  } > "$slash"
  expect_fail "$slash" "leading-slash pattern"

  local whole="$tmpdir/whole"
  {
    cat "$good"
    echo '*'
  } > "$whole"
  expect_fail "$whole" "whole-context glob"

  local fe="$tmpdir/frontend"
  {
    cat "$good"
    echo 'frontend'
  } > "$fe"
  expect_fail "$fe" "frontend tree drop"

  local nginx="$tmpdir/nginx"
  {
    cat "$good"
    echo 'deploy/nginx.conf'
  } > "$nginx"
  expect_fail "$nginx" "deploy/nginx.conf drop"

  local neg="$tmpdir/neg"
  {
    cat "$good"
    echo '!frontend/node_modules'
  } > "$neg"
  expect_fail "$neg" "negation"

  local spaced="$tmpdir/spaced"
  {
    cat "$good"
    echo '  !sneaky'
  } > "$spaced"
  expect_fail "$spaced" "leading-space negation"

  trap - EXIT
  rm -rf "$tmpdir"
  echo "ok: root .dockerignore selftest"
}

if [[ "${1:-}" == "--selftest" ]]; then
  run_selftest
  exit 0
fi

check_file "$DOCKERIGNORE_FILE"
echo "ok: root .dockerignore"

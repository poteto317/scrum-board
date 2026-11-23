#!/usr/bin/env bash
# Fail if Angular production still defers CSS via media=print onload.
# CSP script-src 'self' blocks that inline handler → styles never apply on screen (#138).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AJ="$ROOT/frontend/angular.json"

python3 - <<'PY' "$AJ"
import json, sys
path = sys.argv[1]
cfg = json.load(open(path))
opt = (
    cfg.get("projects", {})
    .get("frontend", {})
    .get("architect", {})
    .get("build", {})
    .get("configurations", {})
    .get("production", {})
    .get("optimization", {})
)
styles = opt.get("styles") if isinstance(opt, dict) else None
if not isinstance(styles, dict) or styles.get("inlineCritical") is not False:
    print(
        "error: frontend/angular.json production.optimization.styles.inlineCritical must be false "
        "(CSP blocks media=print onload=this.media='all')",
        file=sys.stderr,
    )
    sys.exit(1)
print("ok: inlineCritical disabled (CSP-safe stylesheet link)")
PY

INDEX="$ROOT/frontend/dist/frontend/browser/index.html"
if [[ -f "$INDEX" ]]; then
  if grep -Eq 'rel="stylesheet"[^>]*media="print"[^>]*onload=' "$INDEX" \
    || grep -Eq 'rel="stylesheet"[^>]*onload=[^>]*media="print"' "$INDEX"; then
    echo "error: $INDEX still defers CSS with media=print onload (rebuild after inlineCritical:false)" >&2
    exit 1
  fi
  echo "ok: built index.html has no deferred stylesheet onload"
fi

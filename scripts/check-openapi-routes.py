#!/usr/bin/env python3
"""Compare handler.go mux routes to docs/openapi.yaml paths (optional local check)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HANDLER = ROOT / "backend" / "internal" / "kanban" / "handler.go"
OPENAPI = ROOT / "docs" / "openapi.yaml"

# Keep in sync with backend/internal/kanban/auth_middleware.go
# (sessionExempt / sessionOptional). That file is the source of truth.
EXEMPT = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/trash/purge"),
    ("POST", "/api/recurring/run"),
    ("POST", "/api/archive/auto-archive"),
    ("GET", "/api/public-config"),
    ("GET", "/api/health"),
}
SCHEDULER_EXEMPT = {
    ("POST", "/api/trash/purge"),
    ("POST", "/api/recurring/run"),
    ("POST", "/api/archive/auto-archive"),
}
OPTIONAL = {
    ("GET", "/api/items/{id}"),
    ("GET", "/api/items/by-number/{number}"),
    ("GET", "/api/items/by-number/{number}/attachments"),
    ("GET", "/api/items/by-number/{number}/attachments/{id}/content"),
}


def handler_routes() -> list[tuple[str, str]]:
    text = HANDLER.read_text(encoding="utf-8")
    return re.findall(r'mux\.HandleFunc\("([A-Z]+) ([^"]+)"', text)


def main() -> int:
    try:
        import yaml  # type: ignore
    except ImportError:
        print("PyYAML required: pip install pyyaml", file=sys.stderr)
        return 2

    doc = yaml.safe_load(OPENAPI.read_text(encoding="utf-8"))
    paths = doc.get("paths") or {}
    missing = []
    security_bad = []
    for method, path in handler_routes():
        op = (paths.get(path) or {}).get(method.lower())
        if not op:
            missing.append(f"{method} {path}")
            continue
        sec = op.get("security")
        key = (method, path)
        if key in SCHEDULER_EXEMPT:
            required = [{"schedulerJobToken": []}, {"cookieAuth": []}]
            if sec != required:
                security_bad.append(f"{method} {path}: expected schedulerJobToken OR cookieAuth, got {sec!r}")
        elif key in EXEMPT or key in OPTIONAL:
            if sec != []:
                security_bad.append(f"{method} {path}: expected security [], got {sec!r}")
            if key in OPTIONAL and "viewAccess=public" not in (op.get("description") or ""):
                security_bad.append(f"{method} {path}: optional description missing viewAccess=public")
        else:
            required = [{"cookieAuth": []}, {"basicAuth": []}]
            if sec != required:
                security_bad.append(f"{method} {path}: expected cookieAuth OR basicAuth, got {sec!r}")

    # openapi paths/methods not in handler
    handler_set = {(m, p) for m, p in handler_routes()}
    surplus = []
    for path, methods in paths.items():
        for method in methods:
            key = (method.upper(), path)
            if key not in handler_set:
                surplus.append(f"{method.upper()} {path}")

    if missing or security_bad or surplus:
        for line in missing:
            print("missing:", line)
        for line in security_bad:
            print("security:", line)
        for line in surplus:
            print("surplus:", line)
        return 1
    print(f"ok: {len(handler_routes())} operations match openapi + security policy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

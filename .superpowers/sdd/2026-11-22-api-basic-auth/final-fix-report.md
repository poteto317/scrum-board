# API Basic auth — final fix report

## Wave: Sec-Fetch-Site gates app Basic

### Problem

Production nginx sends `Authorization: Basic` (AUTH_*) on every proxied request; browsers resend it on all `/api/*` fetches. After app-level Basic auth, Go treated matching credentials as `CurrentUser` without a cookie, breaking `/login` guestGuard and logout when AUTH_* matched a `users` password.

### Fix

- `basicAuthEligible`: honor app Basic only when `Sec-Fetch-Site` header is absent (curl/agents/scripts).
- Valid cookie unchanged; invalid cookie still falls through to Basic only when eligible.

### Tests

Extended `TestSessionMiddlewareBasicAuth`: Sec-Fetch-Site + Basic without cookie → 401; cookie + Sec-Fetch-Site → 200; existing no-header Basic cases unchanged.

### Docs

OpenAPI `basicAuth` description, design spec row, `docs/api.md` CLI line, `update-api-doc` skill wording.

### Out of scope

nginx continues to pass `Authorization`; no strip at edge.
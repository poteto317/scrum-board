# Security Policy

## Supported versions

This project is a local learning MVP. Only the latest `main` is maintained.

## Reporting a vulnerability

Please do **not** open a public issue for security reports that include secrets or exploit details.

- Prefer GitHub Security Advisories for this repository, or
- Contact the repository owner via GitHub.

## Authentication and authorization (current)

The HTTP API is **not** open. Behavior depends on the layer:

| Layer | Role |
| --- | --- |
| App Cookie session (`sb_session`) | Primary browser path after `POST /api/auth/login` |
| App HTTP Basic | Credentials must match a row in `users` (browsers included; edge Basic that differs from the app password still fails); failures are rate limited like `POST /api/auth/login` (5 failures → 15 min lock per login name and per client IP) on **separate counters**, and a missing/disabled user still runs a dummy bcrypt compare |
| Roles | `admin` / `member` (and related checks in handlers) |
| Item ACL | Per-item view/edit access where configured |
| Production nginx Basic (`AUTH_USER` / `AUTH_PASSWORD`) | Edge gate on the **UI** (`location /`) in the Cloud Run image; `/api/` is app session / app Basic only (mobile browsers often omit `Authorization` on XHR). **Not** the same secret as the app admin password |

`AUTH_USER` is also the login name for the empty-DB admin seed (Compose and Cloud Run). When `users` is empty, `AUTH_USER` and `ADMIN_INITIAL_PASSWORD` are required; when users already exist, seed is a no-op and those env vars may be omitted. **`ADMIN_INITIAL_PASSWORD` must differ from `AUTH_PASSWORD` when both are set** so shared edge Basic cannot log in as admin (L-1001).

Session-exempt and optional routes are documented in [docs/openapi.yaml](docs/openapi.yaml) (implementation: `auth_middleware.go`).

### Known limitations of login / Basic rate limiting

- If browsers resend cached edge Basic to `/api/`, the client IP can get Basic-locked for 15 minutes; CLI users behind the same IP then get 401 with correct app credentials. Workaround: `POST /api/auth/login` and send the `sb_session` cookie (`-b`). The login form is not affected (separate counters).
- `Allow` and `RecordFailure` run in separate critical sections with the DB lookup and bcrypt in between, so concurrent requests can exceed 5 attempts before the lock applies (L-986). The effective per-burst ceiling is nginx `api_login` (1r/s, burst 5) for login and `api_general` (10r/s, burst 20) for Basic.
- Counters are process-local memory; they are not shared across instances.
- The per-IP key is whatever `clientIP` sees: nginx sets `X-Real-IP` from `$remote_addr` without `set_real_ip_from`. Behind Cloud Run's front end, `$remote_addr` may be the platform proxy address shared by all clients, in which case one client's 5 failures lock login (429) or Basic (401) for **every** client for 15 minutes. Confirm the observed address in production before relying on per-IP isolation; fixing it needs nginx `real_ip` configuration for the platform proxy range.
- The per-login-name key is `strings.ToLower(loginName)`, but `users.login_name` uses `utf8mb4_0900_ai_ci`, which also ignores accents and width (`ádmin`, `ａｄｍｉｎ` match `admin`). Spelling variants therefore get separate login-name counters; only the per-IP key bounds them. Closing this needs a canonical key (for example from the matched row) or a binary collation for `login_name`.

## Important deployment notes

- Docker Compose binds services to `127.0.0.1` by default. Do not expose the stack to the public internet without TLS and reviewing auth settings.
- Default database passwords in `.env.example` / Compose (`scrum_dev`, `root_dev_only`) and local seed passwords (`local_dev_admin`, etc.) are for **local development only**. Change them before any shared or hosted use.
- Production deploy uses Secret Manager for `DB_PASSWORD` / `AUTH_PASSWORD` / `ADMIN_INITIAL_PASSWORD`. Keep edge Basic and the admin initial password **separate**, rotate values, and restrict IAM.
- Optional AI card formatting (`POST /api/cards/refined`) sends draft text to Anthropic when `ANTHROPIC_API_KEY` is set and may incur usage charges. Keep the key in an untracked `.env` (or your secret store), never in git.

## Secret hygiene

- Do not commit `.env`, API keys, tokens, or private keys.
- If a secret is ever committed, rotate it immediately and scrub history if needed.

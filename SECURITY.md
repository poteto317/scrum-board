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
| App HTTP Basic | Credentials must match a row in `users` (browsers included; edge Basic that differs from the app password still fails); failures are rate limited like `POST /api/auth/login` (5 failures → 15 min lock per client IP and per login-name + client-IP pair) on **separate counters**, and a missing/disabled user still runs a dummy bcrypt compare |
| Roles | `admin` / `member` (and related checks in handlers) |
| Item ACL | Per-item view/edit access where configured |
| Production nginx Basic (`AUTH_USER` / `AUTH_PASSWORD`) | Edge gate on the **UI** (`location /`) in the Cloud Run image; `/api/` is app session / app Basic only (mobile browsers often omit `Authorization` on XHR). **Not** the same secret as the app admin password |

`AUTH_USER` is also the login name for the empty-DB admin seed (Compose and Cloud Run). When `users` is empty, `AUTH_USER` and `ADMIN_INITIAL_PASSWORD` are required; when users already exist, seed is a no-op and those env vars may be omitted. **`ADMIN_INITIAL_PASSWORD` must differ from `AUTH_PASSWORD` when both are set** so shared edge Basic cannot log in as admin (L-1001).

Session-exempt and optional routes are documented in [docs/openapi.yaml](docs/openapi.yaml) (implementation: `auth_middleware.go`).

### Known limitations of login / Basic rate limiting

- If browsers resend cached edge Basic to `/api/`, the client IP can get Basic-locked for 15 minutes; CLI users behind the same IP then get 401 with correct app credentials. Workaround: `POST /api/auth/login` and send the `sb_session` cookie (`-b`). The login form is not affected (separate counters).
- `Allow` and `RecordFailure` run in separate critical sections with the DB lookup and bcrypt in between, so concurrent requests can exceed 5 attempts before the lock applies (L-986). The effective per-burst ceiling is nginx `api_login` (1r/s, burst 5) for login and `api_general` (10r/s, burst 20) for Basic.
- Counters are process-local memory; they are not shared across instances.
- The per-IP key comes from nginx: `deploy/nginx.conf` trusts only Cloud Run's front end (`set_real_ip_from 169.254.0.0/16`, `real_ip_header X-Forwarded-For`, `real_ip_recursive on`), so `$remote_addr` (nginx `limit_req` keys and `X-Real-IP` to the API) is the real client (before #171, production showed `169.254.169.126` for every client). The app's counters bucket IPv6 clients by /64 (one client usually owns a whole /64); nginx `limit_req` still keys per address. Clients sharing one egress IP (NAT, office LAN, carrier-grade NAT) or one IPv6 /64 still share the lock, and clients sharing one address share the `limit_req` budget. If Cloud Run's front-end address range changes, realip stops applying and every client shares one key again; `scripts/check-nginx-real-ip.sh` guards the config, and production access logs should be checked after any deploy that changes `deploy/nginx.conf` (including a request with a spoofed `X-Forwarded-For`) and after platform changes.
- The login-name part of the pair key is `strings.ToLower(loginName)`, while `users.login_name` uses `utf8mb4_0900_ai_ci` (also ignores accents and width). Spelling variants get separate pair counters, but every failure also counts toward the per-IP key, so variants give no extra attempts per IP.
- There is no per-account cap across IPs: an attacker with many IPs can try one account 5 times per IP per 15 minutes. This was chosen so that nobody can lock someone else's login from another address (#171). Because IPv6 is bucketed by /64 (see the per-IP key item), rotating addresses inside a /64 does not reset the lock.

## Important deployment notes

- Docker Compose binds services to `127.0.0.1` by default. Do not expose the stack to the public internet without TLS and reviewing auth settings.
- Default database passwords in `.env.example` / Compose (`scrum_dev`, `root_dev_only`) and local seed passwords (`local_dev_admin`, etc.) are for **local development only**. Change them before any shared or hosted use.
- Production deploy uses Secret Manager for `DB_PASSWORD` / `AUTH_PASSWORD` / `ADMIN_INITIAL_PASSWORD`. Keep edge Basic and the admin initial password **separate**, rotate values, and restrict IAM.
- Optional AI card formatting (`POST /api/cards/refined`) sends draft text to Anthropic when `ANTHROPIC_API_KEY` is set and may incur usage charges. Keep the key in an untracked `.env` (or your secret store), never in git.

## Secret hygiene

- Do not commit `.env`, API keys, tokens, or private keys.
- If a secret is ever committed, rotate it immediately and scrub history if needed.

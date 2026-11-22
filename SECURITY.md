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
| App HTTP Basic | Non-browser clients (no `Sec-Fetch-Site`); credentials must match a row in `users` |
| Roles | `admin` / `member` (and related checks in handlers) |
| Item ACL | Per-item view/edit access where configured |
| Production nginx Basic (`AUTH_USER` / `AUTH_PASSWORD`) | Edge gate on the Cloud Run image; **not** the same secret as the app admin password |

`AUTH_USER` is also the login name for the empty-DB admin seed (Compose and Cloud Run). When `users` is empty, `AUTH_USER` and `ADMIN_INITIAL_PASSWORD` are required; when users already exist, seed is a no-op and those env vars may be omitted. **`ADMIN_INITIAL_PASSWORD` must differ from `AUTH_PASSWORD` when both are set** so shared edge Basic cannot log in as admin (L-1001).

Session-exempt and optional routes are documented in [docs/openapi.yaml](docs/openapi.yaml) (implementation: `auth_middleware.go`).

## Important deployment notes

- Docker Compose binds services to `127.0.0.1` by default. Do not expose the stack to the public internet without TLS and reviewing auth settings.
- Default database passwords in `.env.example` / Compose (`scrum_dev`, `root_dev_only`) and local seed passwords (`local_dev_admin`, etc.) are for **local development only**. Change them before any shared or hosted use.
- Production deploy uses Secret Manager for `DB_PASSWORD` / `AUTH_PASSWORD` / `ADMIN_INITIAL_PASSWORD`. Keep edge Basic and the admin initial password **separate**, rotate values, and restrict IAM.
- Optional AI card formatting (`POST /api/cards/refined`) sends draft text to Anthropic when `ANTHROPIC_API_KEY` is set and may incur usage charges. Keep the key in an untracked `.env` (or your secret store), never in git.

## Secret hygiene

- Do not commit `.env`, API keys, tokens, or private keys.
- If a secret is ever committed, rotate it immediately and scrub history if needed.

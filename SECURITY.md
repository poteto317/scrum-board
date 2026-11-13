# Security Policy

## Supported versions

This project is a local learning MVP. Only the latest `main` is maintained.

## Reporting a vulnerability

Please do **not** open a public issue for security reports that include secrets or exploit details.

- Prefer GitHub Security Advisories for this repository, or
- Contact the repository owner via GitHub.

## Important deployment notes

- The HTTP API has **no authentication**. Docker Compose binds services to `127.0.0.1` by default. Do not expose the stack to the public internet without adding auth, TLS, and network controls.
- Default database passwords in `.env.example` / Compose (`scrum_dev`, `root_dev_only`) are for **local development only**. Change them before any shared or hosted use.
- Optional AI card formatting (`POST /api/cards/refined`) sends draft text to Anthropic when `ANTHROPIC_API_KEY` is set and may incur usage charges. Keep the key in an untracked `.env` (or your secret store), never in git.

## Secret hygiene

- Do not commit `.env`, API keys, tokens, or private keys.
- If a secret is ever committed, rotate it immediately and scrub history if needed.

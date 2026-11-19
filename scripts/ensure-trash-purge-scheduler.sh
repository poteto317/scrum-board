#!/usr/bin/env bash
# Ensure a daily Cloud Scheduler job that POSTs /api/trash/purge with Basic auth.
#
# Usage (after deploy; same env as deploy-gcp.sh):
#   AUTH_USER=... AUTH_PASSWORD=... PUBLIC_ORIGIN=https://....run.app \
#     ./scripts/ensure-trash-purge-scheduler.sh
#
# Optional overrides:
#   GCP_PROJECT, GCP_REGION, SCHEDULER_JOB_NAME (default: scrum-board-trash-purge)
#   SCHEDULER_CRON (default: 15 3 * * *  — 03:15 Asia/Tokyo)
#   SCHEDULER_TZ (default: Asia/Tokyo)
#
# Idempotent: create-or-update via gcloud scheduler jobs update / create.
set -euo pipefail

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: $name must be set" >&2
    exit 1
  fi
}

GCP_PROJECT="${GCP_PROJECT:-daily-routine-app-8a832}"
GCP_REGION="${GCP_REGION:-asia-northeast1}"
SCHEDULER_JOB_NAME="${SCHEDULER_JOB_NAME:-scrum-board-trash-purge}"
SCHEDULER_CRON="${SCHEDULER_CRON:-15 3 * * *}"
SCHEDULER_TZ="${SCHEDULER_TZ:-Asia/Tokyo}"

require GCP_PROJECT
require GCP_REGION
require AUTH_USER
require AUTH_PASSWORD
require PUBLIC_ORIGIN

# Strip trailing slash for a stable URI.
ORIGIN="${PUBLIC_ORIGIN%/}"
URI="${ORIGIN}/api/trash/purge"

AUTH_HEADER="Authorization: Basic $(printf '%s:%s' "$AUTH_USER" "$AUTH_PASSWORD" | base64 | tr -d '\n')"

echo "==> Ensuring Cloud Scheduler job ${SCHEDULER_JOB_NAME}"
echo "    URI: ${URI}"
echo "    Cron: ${SCHEDULER_CRON} (${SCHEDULER_TZ})"

if gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" \
  --location="$GCP_REGION" \
  --project="$GCP_PROJECT" &>/dev/null; then
  gcloud scheduler jobs update http "$SCHEDULER_JOB_NAME" \
    --location="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --schedule="$SCHEDULER_CRON" \
    --time-zone="$SCHEDULER_TZ" \
    --uri="$URI" \
    --http-method=POST \
    --headers="$AUTH_HEADER" \
    --attempt-deadline=120s
  echo "Updated existing job ${SCHEDULER_JOB_NAME}"
else
  gcloud scheduler jobs create http "$SCHEDULER_JOB_NAME" \
    --location="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --schedule="$SCHEDULER_CRON" \
    --time-zone="$SCHEDULER_TZ" \
    --uri="$URI" \
    --http-method=POST \
    --headers="$AUTH_HEADER" \
    --attempt-deadline=120s
  echo "Created job ${SCHEDULER_JOB_NAME}"
fi

echo ""
echo "Manual check (local or against PUBLIC_ORIGIN):"
echo "  curl -sS -u \"\$AUTH_USER:\$AUTH_PASSWORD\" -X POST \"\${PUBLIC_ORIGIN%/}/api/trash/purge\""

#!/usr/bin/env bash
# Ensure a daily Cloud Scheduler job that POSTs /api/archive/auto-archive with X-Scheduler-Token.
#
# Usage (after deploy; same env as deploy-gcp.sh):
#   GCP_PROJECT=... SCHEDULER_JOB_TOKEN=... PUBLIC_ORIGIN=https://....run.app \
#     ./scripts/ensure-archive-scheduler.sh
#
# Required: GCP_PROJECT, SCHEDULER_JOB_TOKEN, PUBLIC_ORIGIN
# Optional overrides:
#   GCP_REGION (default: asia-northeast1)
#   SCHEDULER_JOB_NAME (default: scrum-board-archive-auto)
#   SCHEDULER_CRON (default: 30 3 * * * — 03:30 Asia/Tokyo)
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

GCP_REGION="${GCP_REGION:-asia-northeast1}"
SCHEDULER_JOB_NAME="${SCHEDULER_JOB_NAME:-scrum-board-archive-auto}"
SCHEDULER_CRON="${SCHEDULER_CRON:-30 3 * * *}"
SCHEDULER_TZ="${SCHEDULER_TZ:-Asia/Tokyo}"

require GCP_PROJECT
require GCP_REGION
require SCHEDULER_JOB_TOKEN
require PUBLIC_ORIGIN

ORIGIN="${PUBLIC_ORIGIN%/}"
if [[ "$ORIGIN" != https://* ]]; then
  echo "error: PUBLIC_ORIGIN must start with https:// (got: $ORIGIN)" >&2
  exit 1
fi
URI="${ORIGIN}/api/archive/auto-archive"

TOKEN_HEADER="X-Scheduler-Token=${SCHEDULER_JOB_TOKEN}"
CT_HEADER="Content-Type=application/json"

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
    --headers="$CT_HEADER" \
    --headers="$TOKEN_HEADER" \
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
    --headers="$CT_HEADER" \
    --headers="$TOKEN_HEADER" \
    --attempt-deadline=120s
  echo "Created job ${SCHEDULER_JOB_NAME}"
fi

echo ""
echo "Manual check (against PUBLIC_ORIGIN):"
echo "  curl -sS -H \"Content-Type: application/json\" -H \"X-Scheduler-Token: \$SCHEDULER_JOB_TOKEN\" -X POST \"\${PUBLIC_ORIGIN%/}/api/archive/auto-archive\" -d '{}'"

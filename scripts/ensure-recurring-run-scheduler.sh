#!/usr/bin/env bash
# Ensure a Cloud Scheduler job that POSTs /api/recurring/run with X-Scheduler-Token.
# Effective minimum interval is this schedule's granularity (default every 15 minutes),
# even if a rule's cron is finer.
#
# Usage (after deploy; same env as deploy-gcp.sh):
#   SCHEDULER_JOB_TOKEN=... PUBLIC_ORIGIN=https://....run.app \
#     ./scripts/ensure-recurring-run-scheduler.sh
#
# Optional overrides:
#   GCP_PROJECT, GCP_REGION, SCHEDULER_JOB_NAME (default: scrum-board-recurring-run)
#   SCHEDULER_CRON (default: */15 * * * *  — every 15 minutes Asia/Tokyo)
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
SCHEDULER_JOB_NAME="${SCHEDULER_JOB_NAME:-scrum-board-recurring-run}"
SCHEDULER_CRON="${SCHEDULER_CRON:-*/15 * * * *}"
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
URI="${ORIGIN}/api/recurring/run"

TOKEN_HEADER="X-Scheduler-Token=${SCHEDULER_JOB_TOKEN}"
CT_HEADER="Content-Type=application/json"

echo "==> Ensuring Cloud Scheduler job ${SCHEDULER_JOB_NAME}"
echo "    URI: ${URI}"
echo "    Cron: ${SCHEDULER_CRON} (${SCHEDULER_TZ})"
echo "    Note: effective shortest fire interval is bounded by this schedule."

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
echo "  curl -sS -H \"Content-Type: application/json\" -H \"X-Scheduler-Token: \$SCHEDULER_JOB_TOKEN\" -X POST \"\${PUBLIC_ORIGIN%/}/api/recurring/run\" -d '{}'"
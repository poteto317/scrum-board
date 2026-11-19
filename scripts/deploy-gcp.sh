#!/usr/bin/env bash
# Build deploy/Dockerfile, push to Artifact Registry, deploy Cloud Run (+ optional Cloud SQL).
# Secrets (AUTH_PASSWORD, DB_PASSWORD) must come from the environment or Secret Manager — never commit them.
# Production should mount secrets from Secret Manager; env-vars-file below only avoids comma-delimited
# --set-env-vars parsing issues for trial/passwords that contain commas or equals signs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: $name must be set" >&2
    exit 1
  fi
}

GCP_PROJECT="${GCP_PROJECT:-daily-routine-app-8a832}"
GCP_REGION="${GCP_REGION:-asia-northeast1}"
AR_REPO="${AR_REPO:-scrum-board}"
SERVICE_NAME="${SERVICE_NAME:-scrum-board}"
IMAGE_NAME="${IMAGE_NAME:-app}"

require GCP_PROJECT
require GCP_REGION
require AR_REPO
require SERVICE_NAME

# Cloud Run + DB (required for deploy)
require CLOUDSQL_INSTANCE
require DB_USER
require DB_PASSWORD
require DB_NAME
require AUTH_USER
require AUTH_PASSWORD

# PUBLIC_ORIGIN: required by entrypoint (must be http(s)://). If unset, bootstrap with
# https://example.com then overwrite with the real SERVICE_URL after deploy (below).
# Do not use https://placeholder.invalid — entrypoint rejects that host.
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://example.com}"

IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/${IMAGE_NAME}:latest"

echo "==> Ensuring Artifact Registry repository ${AR_REPO} (${GCP_REGION})"
if ! gcloud artifacts repositories describe "$AR_REPO" \
  --location="$GCP_REGION" \
  --project="$GCP_PROJECT" &>/dev/null; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --description="scrum-board production images"
fi

echo "==> Configuring docker auth for ${GCP_REGION}-docker.pkg.dev"
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

echo "==> Building image from deploy/Dockerfile (linux/amd64 for Cloud Run)"
docker build --platform linux/amd64 -f deploy/Dockerfile -t "$IMAGE_URI" .

echo "==> Pushing ${IMAGE_URI}"
docker push "$IMAGE_URI"

DB_SOCKET="/cloudsql/${CLOUDSQL_INSTANCE}"

yaml_env_value() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

ENV_VARS_FILE="$(mktemp)"
trap 'rm -f "$ENV_VARS_FILE"' EXIT
{
  echo "DB_USER: $(yaml_env_value "$DB_USER")"
  echo "DB_PASSWORD: $(yaml_env_value "$DB_PASSWORD")"
  echo "DB_NAME: $(yaml_env_value "$DB_NAME")"
  echo "DB_SOCKET: $(yaml_env_value "$DB_SOCKET")"
  echo "PUBLIC_ORIGIN: $(yaml_env_value "$PUBLIC_ORIGIN")"
  echo "AUTH_USER: $(yaml_env_value "$AUTH_USER")"
  echo "AUTH_PASSWORD: $(yaml_env_value "$AUTH_PASSWORD")"
} >"$ENV_VARS_FILE"

echo "==> Deploying Cloud Run service ${SERVICE_NAME}"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --add-cloudsql-instances="$CLOUDSQL_INSTANCE" \
  --env-vars-file="$ENV_VARS_FILE" \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 \
  --memory=512Mi \
  --cpu-boost \
  --timeout=300 \
  --startup-probe=tcpSocket.port=8080,periodSeconds=5,failureThreshold=48,timeoutSeconds=3

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT" \
  --format='value(status.url)')"

if [[ "$PUBLIC_ORIGIN" != "$SERVICE_URL" ]]; then
  echo "==> Setting PUBLIC_ORIGIN to service URL ${SERVICE_URL}"
  gcloud run services update "$SERVICE_NAME" \
    --region="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --update-env-vars "PUBLIC_ORIGIN=${SERVICE_URL}"
  PUBLIC_ORIGIN="$SERVICE_URL"
fi

echo ""
echo "Deployed: ${SERVICE_URL}"
echo "PUBLIC_ORIGIN=${PUBLIC_ORIGIN}"
echo ""
echo "Smoke (Basic Auth):"
echo "  curl -sS -u '${AUTH_USER}:***' '${SERVICE_URL}/api/board' | head"
echo "  curl -sS -o /dev/null -w '%{http_code}\n' '${SERVICE_URL}/health'   # expect 200 without auth"
echo ""
echo "Trash purge Scheduler (daily POST /api/trash/purge):"
echo "  AUTH_USER=... AUTH_PASSWORD=... PUBLIC_ORIGIN=${PUBLIC_ORIGIN} ./scripts/ensure-trash-purge-scheduler.sh"

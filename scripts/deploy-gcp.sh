#!/usr/bin/env bash
# Build deploy/Dockerfile, push to Artifact Registry, deploy Cloud Run (+ Cloud SQL).
# Passwords (AUTH_PASSWORD, ADMIN_INITIAL_PASSWORD, DB_PASSWORD) are written to Secret Manager
# and mounted with --set-secrets — never left as plaintext Cloud Run env vars.
# Non-secret config still uses --env-vars-file (avoids comma/= parsing issues in --set-env-vars).
#
# Required: GCP_PROJECT, CLOUDSQL_INSTANCE, DB_USER, DB_PASSWORD, DB_NAME,
#   AUTH_USER, AUTH_PASSWORD, ADMIN_INITIAL_PASSWORD, SCHEDULER_JOB_TOKEN
# Optional: GCP_REGION (default asia-northeast1), AR_REPO, SERVICE_NAME, PUBLIC_ORIGIN, SECRET_ID_*
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

GCP_REGION="${GCP_REGION:-asia-northeast1}"
AR_REPO="${AR_REPO:-scrum-board}"
SERVICE_NAME="${SERVICE_NAME:-scrum-board}"
IMAGE_NAME="${IMAGE_NAME:-app}"

SECRET_ID_DB_PASSWORD="${SECRET_ID_DB_PASSWORD:-scrum-board-db-password}"
SECRET_ID_AUTH_PASSWORD="${SECRET_ID_AUTH_PASSWORD:-scrum-board-auth-password}"
SECRET_ID_ADMIN_INITIAL_PASSWORD="${SECRET_ID_ADMIN_INITIAL_PASSWORD:-scrum-board-admin-initial-password}"
SECRET_ID_SCHEDULER_JOB_TOKEN="${SECRET_ID_SCHEDULER_JOB_TOKEN:-scrum-board-scheduler-job-token}"

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
require ADMIN_INITIAL_PASSWORD
require SCHEDULER_JOB_TOKEN

# Always enforce (even when users already exist and Go seed is a no-op): a shared
# Basic/admin secret in env is a footgun for the next empty-DB rebuild.
if [[ "$ADMIN_INITIAL_PASSWORD" == "$AUTH_PASSWORD" ]]; then
  echo "error: ADMIN_INITIAL_PASSWORD must differ from AUTH_PASSWORD" >&2
  exit 1
fi

# PUBLIC_ORIGIN: required by entrypoint (must be http(s)://). If unset, bootstrap with
# https://example.com then overwrite with the real SERVICE_URL after deploy (below).
# Do not use https://placeholder.invalid — entrypoint rejects that host.
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://example.com}"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "error: git working tree must be clean (IMAGE_TAG is git rev-parse HEAD)" >&2
  exit 1
fi

IMAGE_REPO="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/${IMAGE_NAME}"
IMAGE_TAG="$(git -C "$ROOT" rev-parse HEAD)"
IMAGE_URI="${IMAGE_REPO}:${IMAGE_TAG}"
IMAGE_URI_LATEST="${IMAGE_REPO}:latest"

# Create secret if missing; always add a new version from VALUE. Never print VALUE.
ensure_secret() {
  local secret_id="$1"
  local value="$2"
  if ! gcloud secrets describe "$secret_id" --project="$GCP_PROJECT" &>/dev/null; then
    echo "==> Creating secret ${secret_id}"
    gcloud secrets create "$secret_id" \
      --project="$GCP_PROJECT" \
      --replication-policy=automatic \
      --quiet
  fi
  echo "==> Adding secret version ${secret_id}"
  printf '%s' "$value" | gcloud secrets versions add "$secret_id" \
    --project="$GCP_PROJECT" \
    --data-file=- \
    --quiet >/dev/null
}

# Resolve Cloud Run runtime SA. Prefer the service's configured SA; if the service
# exists but describe fails for a non-404 reason, abort (do not grant Compute default).
resolve_runtime_sa() {
  local sa status err
  status=0
  err="$(mktemp)"
  sa="$(gcloud run services describe "$SERVICE_NAME" \
    --region="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --format='value(spec.template.spec.serviceAccountName)' 2>"$err")" || status=$?
  if [[ "$status" -eq 0 ]]; then
    if [[ -n "$sa" ]]; then
      printf '%s' "$sa"
      rm -f "$err"
      return
    fi
    local project_number
    project_number="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
    rm -f "$err"
    printf '%s' "${project_number}-compute@developer.gserviceaccount.com"
    return
  fi
  if grep -qiE 'NOT_FOUND|NotFound|was not found' "$err" 2>/dev/null; then
    rm -f "$err"
    local project_number
    project_number="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
    printf '%s' "${project_number}-compute@developer.gserviceaccount.com"
    return
  fi
  echo "error: failed to describe Cloud Run service ${SERVICE_NAME} (not treating as missing)" >&2
  cat "$err" >&2 || true
  rm -f "$err"
  exit 1
}

# Classify password env entries in a Cloud Run env yaml file.
# Prints: ok | plaintext | missing
# Reads yaml from file path argv[1] (never via environment — may contain secrets).
classify_password_env_yaml() {
  local yaml_file="$1"
  python3 - "$yaml_file" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
keys = ("DB_PASSWORD", "AUTH_PASSWORD", "ADMIN_INITIAL_PASSWORD")
blocks = re.split(r"\n\s*- name: ", text)
found = {k: None for k in keys}  # None | "secret" | "plain"
for b in blocks:
    name = b.split("\n", 1)[0].strip()
    if name not in keys:
        continue
    if "secretKeyRef" in b or "valueFrom:" in b:
        found[name] = "secret"
    elif re.search(r"(?m)^\s*value:", b):
        found[name] = "plain"
    else:
        found[name] = "plain"  # unknown shape: treat as bad
if any(v is None for v in found.values()):
    print("missing")
elif any(v == "plain" for v in found.values()):
    print("plaintext")
else:
    print("ok")
PY
}

yaml_env_value() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

echo "==> Ensuring Secret Manager API"
gcloud services enable secretmanager.googleapis.com \
  --project="$GCP_PROJECT" \
  --quiet

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

echo "==> Building image from deploy/Dockerfile (linux/amd64 for Cloud Run) tag=${IMAGE_TAG}"
docker build --platform linux/amd64 -f deploy/Dockerfile -t "$IMAGE_URI" -t "$IMAGE_URI_LATEST" .

echo "==> Pushing ${IMAGE_URI} and :latest"
docker push "$IMAGE_URI"
docker push "$IMAGE_URI_LATEST"

# Publish secret versions only after the image is ready to deploy (avoid advancing
# secret versions while build/push can still fail).
ensure_secret "$SECRET_ID_DB_PASSWORD" "$DB_PASSWORD"
ensure_secret "$SECRET_ID_AUTH_PASSWORD" "$AUTH_PASSWORD"
ensure_secret "$SECRET_ID_ADMIN_INITIAL_PASSWORD" "$ADMIN_INITIAL_PASSWORD"
ensure_secret "$SECRET_ID_SCHEDULER_JOB_TOKEN" "$SCHEDULER_JOB_TOKEN"

RUNTIME_SA="$(resolve_runtime_sa)"
echo "==> Granting secretAccessor to runtime SA ${RUNTIME_SA}"
for secret_id in \
  "$SECRET_ID_DB_PASSWORD" \
  "$SECRET_ID_AUTH_PASSWORD" \
  "$SECRET_ID_ADMIN_INITIAL_PASSWORD" \
  "$SECRET_ID_SCHEDULER_JOB_TOKEN"
do
  gcloud secrets add-iam-policy-binding "$secret_id" \
    --project="$GCP_PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
done

DB_SOCKET="/cloudsql/${CLOUDSQL_INSTANCE}"

ENV_VARS_FILE="$(mktemp)"
ENV_YAML_FILE="$(mktemp)"
trap 'rm -f "$ENV_VARS_FILE" "$ENV_YAML_FILE"' EXIT
{
  echo "DB_USER: $(yaml_env_value "$DB_USER")"
  echo "DB_NAME: $(yaml_env_value "$DB_NAME")"
  echo "DB_SOCKET: $(yaml_env_value "$DB_SOCKET")"
  echo "PUBLIC_ORIGIN: $(yaml_env_value "$PUBLIC_ORIGIN")"
  echo "AUTH_USER: $(yaml_env_value "$AUTH_USER")"
} >"$ENV_VARS_FILE"

SET_SECRETS="DB_PASSWORD=${SECRET_ID_DB_PASSWORD}:latest"
SET_SECRETS+=",AUTH_PASSWORD=${SECRET_ID_AUTH_PASSWORD}:latest"
SET_SECRETS+=",ADMIN_INITIAL_PASSWORD=${SECRET_ID_ADMIN_INITIAL_PASSWORD}:latest"
SET_SECRETS+=",SCHEDULER_JOB_TOKEN=${SECRET_ID_SCHEDULER_JOB_TOKEN}:latest"

echo "==> Deploying Cloud Run service ${SERVICE_NAME} (secrets via Secret Manager)"
# gcloud forbids combining --env-vars-file with --remove-env-vars on one invoke;
# mount secrets here, then strip any leftover plaintext password env keys.
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --add-cloudsql-instances="$CLOUDSQL_INSTANCE" \
  --env-vars-file="$ENV_VARS_FILE" \
  --set-secrets="$SET_SECRETS" \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 \
  --memory=512Mi \
  --cpu-boost \
  --timeout=300 \
  --startup-probe=tcpSocket.port=8080,periodSeconds=5,failureThreshold=48,timeoutSeconds=3

gcloud run services describe "$SERVICE_NAME" \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT" \
  --format='yaml(spec.template.spec.containers[0].env)' >"$ENV_YAML_FILE"
case "$(classify_password_env_yaml "$ENV_YAML_FILE")" in
  plaintext)
    echo "==> Removing leftover plaintext password env vars"
    gcloud run services update "$SERVICE_NAME" \
      --region="$GCP_REGION" \
      --project="$GCP_PROJECT" \
      --remove-env-vars=DB_PASSWORD,AUTH_PASSWORD,ADMIN_INITIAL_PASSWORD \
      --quiet
    gcloud run services describe "$SERVICE_NAME" \
      --region="$GCP_REGION" \
      --project="$GCP_PROJECT" \
      --format='yaml(spec.template.spec.containers[0].env)' >"$ENV_YAML_FILE"
    ;;
esac
case "$(classify_password_env_yaml "$ENV_YAML_FILE")" in
  ok) echo "==> secret env assert ok" ;;
  *)
    echo "error: password env keys are missing or still plaintext after deploy" >&2
    exit 1
    ;;
esac

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
echo "Secrets: ${SECRET_ID_DB_PASSWORD}, ${SECRET_ID_AUTH_PASSWORD}, ${SECRET_ID_ADMIN_INITIAL_PASSWORD} (values not shown)"
echo ""
echo "Smoke:"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' '${SERVICE_URL}/health'   # expect 200"
echo "  # Basic only (AUTH_*) → app 401 when admin password differs from AUTH (L-1001)"
echo "  curl -sS -u '${AUTH_USER}:***' '${SERVICE_URL}/api/board' | head"
echo "  # Basic + login Cookie (stdin JSON; use ADMIN_INITIAL_PASSWORD or current admin password)"
echo "  curl -sS -u '${AUTH_USER}:***' -c /tmp/sb.ck -b /tmp/sb.ck -H 'Content-Type: application/json' \\"
echo "    --data-binary @- '${SERVICE_URL}/api/auth/login' <<'EOF'"
echo "  {\"loginName\":\"${AUTH_USER}\",\"password\":\"***\"}"
echo "  EOF"
echo "  curl -sS -u '${AUTH_USER}:***' -b /tmp/sb.ck '${SERVICE_URL}/api/board' | head"
echo ""
echo "Trash purge Scheduler (daily POST /api/trash/purge):"
echo "  SCHEDULER_JOB_TOKEN=... PUBLIC_ORIGIN=${PUBLIC_ORIGIN} ./scripts/ensure-trash-purge-scheduler.sh"
echo "Recurring run Scheduler (every 15m POST /api/recurring/run):"
echo "  SCHEDULER_JOB_TOKEN=... PUBLIC_ORIGIN=${PUBLIC_ORIGIN} ./scripts/ensure-recurring-run-scheduler.sh"

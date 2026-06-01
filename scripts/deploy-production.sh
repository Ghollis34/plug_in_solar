#!/usr/bin/env bash
set -euo pipefail

BRANCH="${WATTPATCH_DEPLOY_BRANCH:-main}"
ROOT="${WATTPATCH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${WATTPATCH_SERVICE_NAME:-wattpatch-referral}"
LOCAL_HEALTH_URL="${WATTPATCH_LOCAL_HEALTH_URL:-http://127.0.0.1:8787/health}"
PUBLIC_URL="${WATTPATCH_PUBLIC_URL:-https://wattpatch.co.uk}"

cd "$ROOT"

retry_command() {
  local description="$1"
  local attempts="$2"
  local delay_seconds="$3"
  shift 3

  echo "Checking ${description}"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if "$@"; then
      return 0
    fi

    if [ "$attempt" -eq "$attempts" ]; then
      echo "${description} failed after ${attempts} attempts" >&2
      return 1
    fi

    echo "${description} not ready yet; retrying in ${delay_seconds}s (${attempt}/${attempts})" >&2
    sleep "$delay_seconds"
  done
}

echo "Deploying WattPatch from origin/${BRANCH} in ${ROOT}"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

npm ci
npm test
npm run build

sudo -n systemctl restart "$SERVICE_NAME"

retry_command "local referral server health" 12 5 curl -fsS "$LOCAL_HEALTH_URL"
printf '\n'

retry_command "public site" 12 5 curl -fsSI "$PUBLIC_URL/" >/dev/null
retry_command "public site health" 12 5 curl -fsS "$PUBLIC_URL/health"
printf '\n'
retry_command "public referral summary" 12 5 curl -fsS "$PUBLIC_URL/api/referrals/summary"
printf '\n'

echo "WattPatch deploy complete: $(git rev-parse HEAD)"

#!/usr/bin/env bash
set -euo pipefail

BRANCH="${WATTPATCH_DEPLOY_BRANCH:-main}"
ROOT="${WATTPATCH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${WATTPATCH_SERVICE_NAME:-wattpatch-referral}"
LOCAL_HEALTH_URL="${WATTPATCH_LOCAL_HEALTH_URL:-http://127.0.0.1:8787/health}"
PUBLIC_URL="${WATTPATCH_PUBLIC_URL:-https://wattpatch.co.uk}"

cd "$ROOT"

echo "Deploying WattPatch from origin/${BRANCH} in ${ROOT}"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

npm ci
npm test
npm run build

sudo -n systemctl restart "$SERVICE_NAME"

echo "Checking local referral server health"
curl -fsS "$LOCAL_HEALTH_URL"
printf '\n'

echo "Checking public site"
curl -fsSI "$PUBLIC_URL/" >/dev/null
curl -fsS "$PUBLIC_URL/health"
printf '\n'
curl -fsS "$PUBLIC_URL/api/referrals/summary"
printf '\n'

echo "WattPatch deploy complete: $(git rev-parse HEAD)"

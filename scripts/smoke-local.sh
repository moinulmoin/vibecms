#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:5173}
RUN_ID="$(date +%s%N)"
EMAIL="smoke-$RUN_ID@example.test"
SITE_SLUG="smoke-blog-$RUN_ID"
COOKIE_JAR=$(mktemp)

curl -fsS "$BASE_URL/login" >/dev/null
curl -fsS -c "$COOKIE_JAR" -H 'content-type: application/json' -H "origin: $BASE_URL" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Password123!\",\"name\":\"Smoke Test\"}" \
  "$BASE_URL/api/auth/sign-up/email" >/dev/null
curl -fsS -b "$COOKIE_JAR" -H "origin: $BASE_URL" -X POST "$BASE_URL/api/onboarding/ensure" >/dev/null
curl -fsS -b "$COOKIE_JAR" -H "origin: $BASE_URL" \
  -d "name=Smoke+Blog&slug=$SITE_SLUG&description=Smoke+test+blog" \
  "$BASE_URL/app/setup/complete" >/dev/null

APP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}:%{redirect_url}' -b "$COOKIE_JAR" "$BASE_URL/app")
case "$APP_STATUS" in
  302:*"/app/billing"|303:*"/app/billing"|302:*"/app/billing?"*|303:*"/app/billing?"*) ;;
  *) echo "expected /app to redirect to /app/billing, got $APP_STATUS" >&2; exit 1 ;;
esac
curl -fsS -b "$COOKIE_JAR" "$BASE_URL/app/billing" >/dev/null

echo "smoke ok"

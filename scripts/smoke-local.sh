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
  200:*)
    CREATE_STATUS=$(curl -sS -o /dev/null -w '%{http_code}:%{redirect_url}' -b "$COOKIE_JAR" -H "origin: $BASE_URL" -H "referer: $BASE_URL/app/posts/new" \
      -d "title=Smoke+Post&slug=smoke-post-$RUN_ID&excerpt=Smoke+post&contentMarkdown=%23%23+Smoke%0A%0ALaunch+smoke+content.&tags=smoke" \
      "$BASE_URL/app/posts/create")
    case "$CREATE_STATUS" in
      302:*"/app/posts/"*"/edit"*|303:*"/app/posts/"*"/edit"*) ;;
      *) echo "expected post create redirect to edit page, got $CREATE_STATUS" >&2; exit 1 ;;
    esac
    REDIRECT_URL=${CREATE_STATUS#*:}
    POST_ID=${REDIRECT_URL#"$BASE_URL/app/posts/"}
    POST_ID=${POST_ID%%/edit*}
    curl -fsS -b "$COOKIE_JAR" -H "origin: $BASE_URL" -H "referer: $BASE_URL/app/posts/$POST_ID/edit" -X POST "$BASE_URL/app/posts/$POST_ID/publish" >/dev/null
    curl -fsS -b "$COOKIE_JAR" "$BASE_URL/app/posts?status=published" >/dev/null
    ;;
  302:*"/app/billing"|303:*"/app/billing"|302:*"/app/billing?"*|303:*"/app/billing?"*)
    curl -fsS -b "$COOKIE_JAR" "$BASE_URL/app/billing" >/dev/null
    ;;
  *) echo "expected /app to load or redirect to /app/billing, got $APP_STATUS" >&2; exit 1 ;;
esac

echo "smoke ok"

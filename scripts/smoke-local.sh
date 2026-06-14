#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:5173}
EXPECT_QUOTA_429=${EXPECT_QUOTA_429:-false}
# EXPECT_QUOTA_429=true fills the disposable local D1 counters for the smoke
# token, then verifies REST and MCP both return 429.
RUN_ID="$(date +%s%N)"
EMAIL="smoke-$RUN_ID@example.test"
SITE_SLUG="smoke-blog-$RUN_ID"
POST_SLUG="smoke-post-$RUN_ID"
COOKIE_JAR=$(mktemp)

curl -fsS "$BASE_URL/login" >/dev/null
# Passwordless sign-in: request a code, read it back from the disposable local
# D1 (emailOTP stores it plain), then verify - the same flow real users get.
curl -fsS -H 'content-type: application/json' -H "origin: $BASE_URL" \
  -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}" \
  "$BASE_URL/api/auth/email-otp/send-verification-otp" >/dev/null
OTP_DB_NAME="${LOCAL_D1_NAME:-vibecms_dev}"
otp_row=$(pnpm --filter @vc/web exec wrangler d1 execute "$OTP_DB_NAME" --local --json --command \
  "SELECT value FROM verification WHERE identifier = 'sign-in-otp-$EMAIL' ORDER BY expires_at DESC LIMIT 1")
SMOKE_OTP=$(ROW_JSON="$otp_row" python3 - <<'PY'
import json, os, re
payload = json.loads(os.environ["ROW_JSON"])
results = payload[0]["results"]
if not results:
    raise SystemExit("no OTP row found in verification table")
print(re.sub(r"[^0-9]", "", results[0]["value"])[:6])
PY
)
curl -fsS -c "$COOKIE_JAR" -H 'content-type: application/json' -H "origin: $BASE_URL" \
  -d "{\"email\":\"$EMAIL\",\"otp\":\"$SMOKE_OTP\"}" \
  "$BASE_URL/api/auth/sign-in/email-otp" >/dev/null
curl -fsS -b "$COOKIE_JAR" -H "origin: $BASE_URL" -X POST "$BASE_URL/api/onboarding/ensure" >/dev/null
curl -fsS -b "$COOKIE_JAR" -H "origin: $BASE_URL" \
  -d "name=Smoke+Blog&slug=$SITE_SLUG&description=Smoke+test+blog" \
  "$BASE_URL/app/setup/complete" >/dev/null
create_api_token() {
  local token_page
  token_page=$(curl -fsSL -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "origin: $BASE_URL" -H "referer: $BASE_URL/app/settings" \
    -d "name=Smoke+Agent&actorName=Smoke+Agent&scopes=sites:read&scopes=posts:read&scopes=posts:create&scopes=posts:publish&scopes=activity:read" \
    "$BASE_URL/app/settings/api-keys/create")
  if [[ "$token_page" =~ (vc_test_[A-Za-z0-9_-]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  echo "expected one-time token reveal" >&2
  exit 1
}

force_quota_exhausted() {
  local api_token="$1"
  local token_prefix="${api_token:0:18}"
  local db_name="${LOCAL_D1_NAME:-vibecms_dev}"
  local row_json
  row_json=$(pnpm --filter @vc/web exec wrangler d1 execute "$db_name" --local --json --command \
    "SELECT api_keys.id AS token_id, api_keys.site_id, sites.workspace_id FROM api_keys JOIN sites ON sites.id = api_keys.site_id WHERE api_keys.token_prefix = '$token_prefix' LIMIT 1")
  local ids
  ids=$(ROW_JSON="$row_json" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["ROW_JSON"])
row = payload[0]["results"][0]
print(row["token_id"], row["site_id"], row["workspace_id"])
PY
)
  read -r token_id site_id workspace_id <<< "$ids"
  local sql
  sql=$(TOKEN_ID="$token_id" SITE_ID="$site_id" WORKSPACE_ID="$workspace_id" python3 - <<'PY'
import os
from datetime import datetime, timezone, timedelta

def q(value):
    return "'" + value.replace("'", "''") + "'"

now = datetime.now(timezone.utc)
minute = now.strftime("%Y-%m-%dT%H:%MZ")
day = now.strftime("%Y-%m-%d")
month = now.strftime("%Y-%m")
timestamp = str(int(now.timestamp()))
workspace_id = os.environ["WORKSPACE_ID"]
site_id = os.environ["SITE_ID"]
token_id = os.environ["TOKEN_ID"]
high = "1000000000"
rows = [
    (f"workspace:{workspace_id}:calls:{minute}", workspace_id, None, minute),
    (f"workspace:{workspace_id}:calls:{day}", workspace_id, None, day),
    (f"workspace:{workspace_id}:calls:{month}", workspace_id, None, month),
    (f"token:{token_id}:calls:{minute}", workspace_id, site_id, minute),
]
statements = []
for row_id, workspace, site, period in rows:
    site_sql = "NULL" if site is None else q(site)
    statements.append(
        "INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at) "
        f"VALUES ({q(row_id)}, {q(workspace)}, {site_sql}, {q(period)}, 'calls', {high}, {timestamp}, {timestamp}) "
        f"ON CONFLICT(id) DO UPDATE SET value = {high}, updated_at = {timestamp}"
    )
print("; ".join(statements) + ";")
PY
)
  pnpm --filter @vc/web exec wrangler d1 execute "$db_name" --local --command "$sql" >/dev/null
}

check_api_surfaces() {
  local api_token="$1"
  local rest_status
  rest_status=$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer $api_token" "$BASE_URL/api/posts?limit=1")
  case "$rest_status" in
    200) ;;
    *) echo "expected REST /api/posts to return 200, got $rest_status" >&2; exit 1 ;;
  esac

  local mcp_body
  mcp_body=$(mktemp)
  local mcp_status
  mcp_status=$(curl -sS -o "$mcp_body" -w '%{http_code}' "$BASE_URL/mcp" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $api_token" \
    --data '{"jsonrpc":"2.0","id":"smoke-tools","method":"tools/list","params":{}}')
  case "$mcp_status" in
    200) ;;
    *) echo "expected MCP tools/list to return 200, got $mcp_status" >&2; exit 1 ;;
  esac

  if [[ "$EXPECT_QUOTA_429" != "true" ]]; then
    return
  fi
  force_quota_exhausted "$api_token"
  rest_status=$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer $api_token" -H "x-vibecms-quota-smoke: 1" "$BASE_URL/api/posts?limit=1")
  case "$rest_status" in
    429) ;;
    *) echo "expected REST quota response 429, got $rest_status" >&2; exit 1 ;;
  esac

  mcp_status=$(curl -sS -o "$mcp_body" -w '%{http_code}' "$BASE_URL/mcp" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $api_token" \
    -H "x-vibecms-quota-smoke: 1" \
    --data '{"jsonrpc":"2.0","id":"quota-tools","method":"tools/list","params":{}}')
  case "$mcp_status" in
    429) ;;
    *) echo "expected MCP quota response 429, got $mcp_status" >&2; exit 1 ;;
  esac
}


APP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}:%{redirect_url}' -b "$COOKIE_JAR" "$BASE_URL/app")
case "$APP_STATUS" in
  200:*)
    CREATE_STATUS=$(curl -sS -o /dev/null -w '%{http_code}:%{redirect_url}' -b "$COOKIE_JAR" -H "origin: $BASE_URL" -H "referer: $BASE_URL/app/posts/new" \
      -d "title=Smoke+Post&slug=$POST_SLUG&excerpt=Smoke+post&contentMarkdown=%23%23+Smoke%0A%0ALaunch+smoke+content.&tags=smoke" \
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
    PUBLIC_POST=$(curl -fsS "$BASE_URL/blog/$SITE_SLUG/$POST_SLUG")
    case "$PUBLIC_POST" in
      *"Launch smoke content."*) ;;
      *) echo "expected public post content on /blog/$SITE_SLUG/$POST_SLUG" >&2; exit 1 ;;
    esac
    API_TOKEN=$(create_api_token)
    check_api_surfaces "$API_TOKEN"
    ;;
  302:*"/app/billing"|303:*"/app/billing"|302:*"/app/billing?"*|303:*"/app/billing?"*)
    curl -fsS -b "$COOKIE_JAR" "$BASE_URL/app/billing" >/dev/null
    ;;
  *) echo "expected /app to load or redirect to /app/billing, got $APP_STATUS" >&2; exit 1 ;;
esac

echo "smoke ok"

#!/usr/bin/env bash
# Proof for the "keep your blog" claim window (plan 027).
#
#   scripts/proof-keep-your-blog.sh local    # hermetic proof in the local worker runtime
#   scripts/proof-keep-your-blog.sh dev      # the real ingresses on the dev deployment
#   scripts/proof-keep-your-blog.sh dev check # re-check the state after the daily sweep tick
#
# The dev proof needs these in the environment (never commit them):
#   INTERNAL_SECRET        the dev deployment's X-AUTOSEOPILOT-INTERNAL-SECRET
#   APP_URL                default https://app.basedui.dev
#   BLOG_HOST              the managed blog's default host, e.g. https://proof-claim.basedui.dev
#   EXTERNAL_WORKSPACE_ID  a throwaway workspace id
#   OWNER_EMAIL            default proof-claim@example.test
#   CUSTOM_DOMAIN          optional: the blog's custom domain (https://host)
#   SUBPATH_URL            optional: the blog's subpath mount (https://host/blog)
#
# The dates move forward instead of waiting: every step backdates `revoked_at`
# in the dev D1 and then re-checks the real ingresses.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

APP_URL="${APP_URL:-https://app.basedui.dev}"
BLOG_HOST="${BLOG_HOST:-}"
EXTERNAL_WORKSPACE_ID="${EXTERNAL_WORKSPACE_ID:-}"
OWNER_EMAIL="${OWNER_EMAIL:-proof-claim@example.test}"
POST_SLUG="${POST_SLUG:-proof-claim-post}"
CREDENTIAL_ID="${CREDENTIAL_ID:-11111111-2222-4333-8444-555555555555}"
GENERATION="${GENERATION:-1}"
# The raw token VibeCMS hashes into the managed API key. Format: vc_test_ + 32-128 chars.
RAW_TOKEN="${RAW_TOKEN:-vc_test_$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9_-' | head -c 48)}"

MODE="${1:-local}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '  ok  %s\n' "$*"; }

require() { command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

# The dev D1 (the same database the dev deployment uses).
d1() {
  pnpm --filter @vc/api exec wrangler d1 execute DB --remote --env development --command "$1" 2>/dev/null
}

# Backdate the revoke so the claim window can be walked without waiting.
backdate_days() {
  local days="$1"
  d1 "UPDATE autoseopilot_managed_sites
      SET revoked_at = CAST(strftime('%s','now') AS INTEGER) - ${days} * 86400,
          updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE external_workspace_id = '${EXTERNAL_WORKSPACE_ID}'" >/dev/null
  say "revoked_at moved back ${days} day(s)"
}

# expect_served <url> [text]  — the blog answers with its own content.
expect_served() {
  local url="$1" needle="${2:-}"
  local out status
  out="$(curl -sS -o /tmp/kb-body -w '%{http_code}' "$url" || true)"
  status="$out"
  if [ "$status" != "200" ]; then
    printf '  body: %s\n' "$(head -c 200 /tmp/kb-body)"
    fail "expected 200 at $url, got $status"
  fi
  if [ -n "$needle" ] && ! grep -q "$needle" /tmp/kb-body; then
    fail "expected '$needle' in $url"
  fi
  ok "served  $url"
}

# expect_paused <url> — every ingress answers with the neutral paused page.
expect_paused() {
  local url="$1"
  local code robots
  code="$(curl -sS -o /tmp/kb-body -D /tmp/kb-head -w '%{http_code}' "$url" || true)"
  robots="$(grep -i '^x-robots-tag:' /tmp/kb-head | tr -d '\r' || true)"
  if ! grep -q 'This blog is paused' /tmp/kb-body; then
    fail "expected the paused page at $url"
  fi
  case "$robots" in
    *noindex*) ;;
    *) fail "expected X-Robots-Tag: noindex at $url, got '${robots:-none}'" ;;
  esac
  if grep -qi '^cache-control:.*public' /tmp/kb-head; then
    fail "expected the paused page not to be publicly cacheable at $url"
  fi
  ok "paused  $url"
}

expect_status() {
  local url="$1" want="$2" code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  [ "$code" = "$want" ] || fail "expected $want at $url, got $code"
  ok "status $want at $url"
}

# ---------------------------------------------------------------- local mode
run_local() {
  say "local proof: the claim window in the worker runtime"
  say "sweep (reminders, purge, claim and resume)"
  pnpm --filter @vc/api exec vitest run src/server/managed-claim-sweep.worker.test.ts
  say "serving gate (paused page on every ingress, indexability)"
  pnpm --filter @vc/public exec vitest run src/server/public-entitlements.worker.test.ts
  say "dashboard (banner and billing copy)"
  pnpm --filter @vc/dashboard exec vitest run \
    src/components/dashboard/KeepYourBlogBanner.test.tsx \
    src/components/dashboard/BillingPage.test.tsx
  ok "local proof finished"
}

# ------------------------------------------------------------------ dev mode
dev_preconditions() {
  require curl
  require jq
  [ -n "${INTERNAL_SECRET:-}" ] || fail "INTERNAL_SECRET is not set"
  [ -n "$BLOG_HOST" ] || fail "BLOG_HOST is not set"
  [ -n "$EXTERNAL_WORKSPACE_ID" ] || fail "EXTERNAL_WORKSPACE_ID is not set"
}

dev_provision() {
  say "provision the managed blog (internal API)"
  local receipt
  receipt="$(curl -sS -X PUT "$APP_URL/internal/autoseopilot/sites/$EXTERNAL_WORKSPACE_ID" \
    -H "X-AUTOSEOPILOT-INTERNAL-SECRET: $INTERNAL_SECRET" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg email "$OWNER_EMAIL" --arg token "$RAW_TOKEN" --arg cred "$CREDENTIAL_ID" --arg gen "$GENERATION" \
      '{ownerEmail:$email, siteName:"Proof Claim Blog", credential:{rawToken:$token, credentialId:$cred, generation:($gen|tonumber)}, entitlement:{status:"active", expiresAt:null}}')")"
  echo "$receipt" | jq -e '.siteId and .workspaceId and .publicUrl' >/dev/null \
    || fail "provision failed: $receipt"
  SITE_ID="$(echo "$receipt" | jq -r '.siteId')"
  WORKSPACE_ID="$(echo "$receipt" | jq -r '.workspaceId')"
  ok "provisioned site $SITE_ID at $(echo "$receipt" | jq -r '.publicUrl')"
}

dev_publish() {
  say "publish a post (REST API with the managed token)"
  local created post_id version
  created="$(curl -sS -X POST "$APP_URL/api/v1/posts" \
    -H "Authorization: Bearer $RAW_TOKEN" -H 'content-type: application/json' \
    -d "$(jq -nc --arg slug "$POST_SLUG" '{title:"Proof claim post", slug:$slug, contentMarkdown:"# Proof\n\nThe blog still serves."}')")"
  post_id="$(echo "$created" | jq -r '.id // empty')"
  version="$(echo "$created" | jq -r '.currentVersionNumber // empty')"
  [ -n "$post_id" ] || fail "post creation failed: $created"
  curl -sS -X POST "$APP_URL/api/v1/posts/$post_id/publish" \
    -H "Authorization: Bearer $RAW_TOKEN" -H 'content-type: application/json' \
    -d "$(jq -nc --argjson v "$version" '{expectedVersionNumber:$v}')" | jq -e '.status' >/dev/null \
    || fail "publish failed"
  POST_ID="$post_id"
  ok "published post $post_id ($POST_SLUG)"
}

# Every ingress the founder named: default host, custom domain, subpath, feeds,
# sitemap, OG, previews and the beacon.
check_ingress_served() {
  say "day 6: the blog is still fully online on every address"
  expect_served "$BLOG_HOST/" "Proof"
  expect_served "$BLOG_HOST/$POST_SLUG" "Proof claim post"
  expect_served "$BLOG_HOST/feed.xml" "$POST_SLUG"
  expect_served "$BLOG_HOST/sitemap.xml" "$POST_SLUG"
  expect_served "$BLOG_HOST/llms.txt" ""
  expect_status "$BLOG_HOST/og.png" "200"
  if [ -n "${CUSTOM_DOMAIN:-}" ]; then
    expect_served "$CUSTOM_DOMAIN/" "Proof"
    expect_served "$CUSTOM_DOMAIN/$POST_SLUG" "Proof claim post"
  fi
  if [ -n "${SUBPATH_URL:-}" ]; then
    expect_served "$SUBPATH_URL/" "Proof"
    expect_served "$SUBPATH_URL/$POST_SLUG" "Proof claim post"
  fi
}

check_ingress_paused() {
  say "day 8: every address answers with the paused page"
  expect_paused "$BLOG_HOST/"
  expect_paused "$BLOG_HOST/$POST_SLUG"
  # Machine surfaces have no page to show: they stop serving the blog (404).
  expect_status "$BLOG_HOST/feed.xml" "404"
  expect_status "$BLOG_HOST/sitemap.xml" "404"
  expect_status "$BLOG_HOST/llms.txt" "404"
  expect_status "$BLOG_HOST/og.png" "404"
  if [ -n "${CUSTOM_DOMAIN:-}" ]; then
    expect_paused "$CUSTOM_DOMAIN/"
    expect_paused "$CUSTOM_DOMAIN/$POST_SLUG"
  fi
  if [ -n "${SUBPATH_URL:-}" ]; then
    expect_paused "$SUBPATH_URL/"
    expect_paused "$SUBPATH_URL/$POST_SLUG"
  fi
}

dev_revoke() {
  say "revoke (day 0)"
  curl -sS -X POST "$APP_URL/internal/autoseopilot/sites/$EXTERNAL_WORKSPACE_ID/revoke" \
    -H "X-AUTOSEOPILOT-INTERNAL-SECRET: $INTERNAL_SECRET" -H 'content-type: application/json' \
    -d "$(jq -nc --arg cred "$CREDENTIAL_ID" --arg gen "$GENERATION" \
      '{credentialId:$cred, generation:($gen|tonumber), reason:"entitlement_lost"}')" \
    | jq -e '.entitlement.status == "revoked"' >/dev/null || fail "revoke failed"
  ok "revoked"
}

dev_sweep_state() {
  say "sweep state (the daily cron runs the sweep at 02:17 UTC)"
  d1 "SELECT entitlement_status, revoked_at, claim_day7_sent_at, claim_day14_sent_at, claim_day21_sent_at, claim_day28_sent_at
      FROM autoseopilot_managed_sites WHERE external_workspace_id = '${EXTERNAL_WORKSPACE_ID}'" \
    | sed 's/^/  /'
}

run_dev() {
  dev_preconditions
  say "prepare"
  dev_provision
  dev_publish
  check_ingress_served
  dev_revoke
  backdate_days 6
  check_ingress_served
  backdate_days 8
  check_ingress_paused
  dev_sweep_state
  cat <<'NOTES'

Next steps (each needs a real trigger):

  * Reminders: the sweep runs on the daily cron (17 2 * * *). Backdate to day 7
    (scripts/proof-keep-your-blog.sh dev + backdate_days 7), wait for the tick,
    then check the owner email and the markers:
      pnpm --filter @vc/api exec wrangler d1 execute DB --remote --env development \
        --command "SELECT claim_day7_sent_at FROM autoseopilot_managed_sites WHERE external_workspace_id = '$EXTERNAL_WORKSPACE_ID'"
    The same for days 14, 21 and 28. A second run must not send again.
  * Claim: buy VibeCMS Cloud on that workspace (Polar sandbox) and re-check the
    blog serves again; the sweep must then skip the blog forever.
  * Deletion: backdate to day 31, let the sweep run, then check the rows, the
    R2 prefix and the login are gone:
      pnpm --filter @vc/api exec wrangler d1 execute DB --remote --env development \
        --command "SELECT id FROM sites WHERE id = '$SITE_ID'"
  * Resume: reactivate the AutoSEOPilot plan and check the clock cleared
    (revoked_at IS NULL) and the blog serves again.
NOTES
}

run_dev_check() {
  dev_preconditions
  dev_sweep_state
}

case "$MODE" in
  local) run_local ;;
  dev) run_dev ;;
  check) run_dev_check ;;
  *) fail "usage: $0 [local|dev|check]" ;;
esac

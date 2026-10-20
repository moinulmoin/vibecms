# 027 - Keep your blog after an AutoSEOPilot plan ends

Status: SHIPPED locally (2026-10-21). The dev-deployment proof is listed at the
end; it still has to run on the dev environment.

## Why

A hosted blog is included with the AutoSEOPilot plan. When the plan ends, the
blog must not vanish the same minute: the owner may still be reading it, may
still be linked to from search results, and may want to keep the blog instead
of starting over. The claim flow gives them 30 days to take the blog with
them — the same blog, posts, media and domain, with nothing to migrate.

## Decisions (founder, 2026-10-20)

- Day 0 is the AutoSEOPilot plan truly ending: the managed revoke landing in
  VibeCMS (`revoked_at`). The clock is VibeCMS's, not AutoSEOPilot's.
- Days 0-7: the blog stays fully online on every address (default host, custom
  domain, subpath), indexed as normal.
- Day 7: the blog is paused on every address (default host, custom domain,
  subpath, feeds, sitemap, OG, previews, beacon). Visitors see a neutral
  "This blog is paused" page with `noindex` — never a bare 404.
- AutoSEOPilot sends one email on day 0. VibeCMS sends the reminders on days
  7, 14, 21 and 28 — each exactly once, and all of them stop as soon as the
  blog is claimed or the AutoSEOPilot plan resumes.
- Claim = sign in to VibeCMS with the same email and buy VibeCMS Cloud. The
  same blog, posts, media and domain come back; nothing moves. A claimed blog
  is never deleted by this flow again, even if Cloud is cancelled later.
- During the 30 days the owner keeps dashboard access, and can read and
  export. No lockout.
- No transfer to a different email.
- Day 30, unclaimed: the blog is deleted (custom hostname, R2 objects, posts,
  media, workspace), and the VibeCMS login is deleted too unless that user
  owns or belongs to another VibeCMS workspace.

## Design

### Serving gate (time-aware)

`evaluateEffectiveHostedEntitlement` gained a claim window next to the paid
effectiveness it already computed:

- `claim` — present while the managed sponsorship is revoked: `{ state, pausedAt, deadline }`.
- `servingAllowed` — paid-effective, self-hosted, or inside the claim grace
  (days 0-7). This is what the public ingresses use.
- `servingPaused` — revoked, past the grace, no other source: every ingress
  answers with the paused page.

The public worker resolves a paused site (so it can render the paused page)
but never its content: the default host, custom domains, the subpath mount,
feeds, sitemap, `llms.txt`, OG cards, previews and the analytics beacon all
answer "This blog is paused" with `X-Robots-Tag: noindex, nofollow` and
`cache-control: no-store`. Indexability follows `servingAllowed`, so days 0-7
stay indexed and the paused page never is.

### Reminders and deletion (one daily job)

`apps/api/src/server/managed-claim-sweep.ts` runs on the existing daily cron:

- Selection: revoked managed sites whose workspace never claimed VibeCMS
  Cloud (no billing row, or status `none`).
- Reminders: days 7/14/21/28, each with its own durable marker column
  (`claim_day7_sent_at` … `claim_day28_sent_at`). The marker is claimed
  before the send, so a reminder goes out at most once; a definitive send
  failure releases the marker and the next daily run retries.
- Deletion: at day 30 the blog is purged — Cloudflare custom hostnames, the
  site's R2 prefix (media and OG cards), and the D1 rows (binding, site,
  workspace, and the user row only when that user has no other workspace).
  The deletion is irreversible, so it is a durable three-step operation: a
  purge intent is written first (one atomic statement that only lands while
  the blog is still revoked, still past its own deadline, still never
  claimed, and that records the resources the purge will delete), the
  external cleanup runs from that intent, and only then are the D1 rows
  deleted. While the intent exists the blog cannot come back — the claim
  checkout is refused before any money is taken, an in-flight billing
  webhook is a conflict, the AutoSEOPilot plan resumption is a retryable
  refusal — and a crashed purge is resumed by the next daily run.

### Dashboard

- The billing payload carries the claim window (`revokedAt`, `pausedAt`,
  `deadline`) whenever the sponsorship is revoked and Cloud was never bought.
- The "Keep your blog" banner appears above every dashboard page with the
  exact deadline and a link to the plan page.
- The billing page no longer promises "Your posts stay online" for a revoked
  sponsorship; it states the grace, the pause, the deadline and the upgrade.

## What shipped

- `packages/config/src/index.ts` — `MANAGED_CLAIM_WINDOW`, `MANAGED_CLAIM_REMINDERS`.
- `packages/db/drizzle/0038_managed_claim_window.sql`, `packages/db/src/schema.ts` — reminder markers + sweep index.
- `packages/db/drizzle/0039_managed_purge_intents.sql`, `packages/db/src/schema.ts` — the durable purge intent and the in-flight claim checkout.
- `packages/db/src/repositories/autoseopilot-managed-sites.ts` — claim window in the entitlement, sweep selection, reminder markers, guarded purge.
- `apps/api/src/server/managed-claim-sweep.ts` — the daily job.
- `apps/api/src/server/email.ts` — the reminder email.
- `apps/api/src/server/dashboard-api.ts` — the claim window in the billing payload.
- `apps/public/src/server/paused-blog.ts` + the public ingresses — the paused page.
- `apps/dashboard/src/components/dashboard/KeepYourBlogBanner.tsx`, `BillingPage.tsx`, `apps/dashboard/src/lib/claim-window.ts` — the banner and the copy.

## Verification

- Unit/worker tests: the claim window in the entitlement, the paused gate on
  every ingress, the reminder markers, the guarded purge, the dashboard
  banner and the billing copy.
- Dev proof (to run): provision a managed site, publish posts, revoke, and
  see the blog served on day 6 and paused on day 8 on every address; each
  reminder sent exactly once (days 7/14/21/28, dates moved forward instead of
  waited for) and all of them stopping after a claim; a claimed blog serving
  again with the sweep skipping it; an unclaimed day 31 purging hostname, R2
  prefix and rows, and deleting the login only when it has no other
  workspace; a plan resumed inside the window clearing the clock.

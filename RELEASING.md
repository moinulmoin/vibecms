# Releasing to production

`pnpm deploy:prod` runs `scripts/deploy-prod.mjs`. It stops at the first failed
step and prints which one. Nothing after that step runs.

## Before the first release of the revamp

Production still runs `main`. This release moves posts to pinned, versioned
public content (migration 0018 onward), so the first deploy is a cutover.

### 1. Launch pricing in Polar (production)

1. Keep the products at the list price: monthly **$15**, yearly **$150**.
2. Create two discounts, duration **forever**, each limited to its product:
   - monthly: **$6 off** → $9/month
   - yearly: **$71 off** → $79/year
3. Add their ids to `apps/api/wrangler.jsonc` under `env.production.vars`:
   `POLAR_LAUNCH_DISCOUNT_MONTHLY_ID`, `POLAR_LAUNCH_DISCOUNT_YEARLY_ID`.
4. Check: `POLAR_SERVER=production POLAR_ACCESS_TOKEN=… pnpm preflight:pricing`.
   Preflight refuses to deploy while the site advertises launch pricing and
   the products or discounts don't produce exactly those prices.

To end launch pricing later: remove the two vars and update `LAUNCH_OFFER` in
`packages/config`. Existing subscribers keep their discount.

### 2. Legacy data

Preflight lists posts that migration 0021 would convert (scheduled posts,
published posts without version history) and blocks until you acknowledge the
exact set with the hashes it prints (`ACK_LEGACY_SCHEDULED_POSTS=<hash>`, `ACK_LEGACY_UNVERSIONED_POSTS=<hash>`). If the affected posts
change, the acknowledgement stops matching.

### 3. Write freeze

The old API can't be paused from the new code. For the ~2 minutes between the
migrations and the new API deploy, **no one may publish or edit on
production**: pause agents that use production keys and don't use the
dashboard. The deploy only starts with `CONFIRM_WRITE_FREEZE=1`.

### 4. Deploy

```sh
CONFIRM_WRITE_FREEZE=1 pnpm deploy:prod
```

On the first cutover the script pins each published post to its live
version while the old API is still serving, then deploys the new API. It
decides this from the migration ledger at the start of the run, so a rerun
never pins again (after the new API is live, a latest version can be a private
draft).

After the API deploys, a read-only check requires every published post to
have a pinned version. If it fails, it lists the posts. Pin each to the version
that was live, then run `pnpm deploy:prod -- --verify-pins` and
`pnpm production:smoke`. Don't rerun the pin SQL by hand after the new API is live.

### 5. After

Reopen writes, then check a published post, a private preview link, a
scheduled post, and a checkout on both plans (the first charge should be $9 / $79).

## Known limits

- The write freeze is manual (see above).
- A checkout retried before the first one completes can leave an extra open
  checkout link. Polar expires unused checkouts; no charge is made.
- The public Worker records no request URLs (preview links carry their token in
  the path). The API Worker's request and error logs redact `/preview/…`.

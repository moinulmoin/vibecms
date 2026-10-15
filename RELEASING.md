# Releasing to production

Hosted production is promoted by the reviewed-commit workflow, a thin wrapper
around `pnpm deploy:prod` (`scripts/deploy-prod.mjs`):

```sh
gh workflow run deploy-production.yml --ref main -f release_sha=<full 40-char sha> -f smoke_mode=authenticated
```

`release_sha` must be the full SHA of the reviewed release commit;
`authenticated` smoke mode requires the `PRODUCTION_SMOKE_TOKEN` environment
secret. `pnpm deploy:prod` stops at the first failed step and prints which
one. Nothing after that step runs.

## CLI releases (npm)

Run `pnpm changeset` for CLI changes; merging into `main` opens a `chore: version packages` PR.
Merging that PR publishes `vibecms-cli` with provenance through npm trusted publishing.
Configure the npm trusted publisher for repository `moinulmoin/vibecms`, workflow `release.yml`.
The first version must be hand-published because the package must exist before trusted-publisher setup.
Before every publish, `prepublishOnly` installs the packed tarball into an empty project and runs the installed `vibecms --version` and `vibecms schema`; a failure stops the publish. Run it any time with `pnpm --filter vibecms-cli smoke`.

## Break-glass local deploy

`pnpm deploy:prod` is the same script the workflow invokes. Run it locally
only when GitHub Actions is unavailable, from a clean checkout of the
reviewed `main` commit. It loads the gitignored `.env.production.local`
itself (values already in your shell win) and refreshes the wrangler login
before preflight. It needs:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PREFLIGHT_API_TOKEN`
- `PRODUCTION_SMOKE_TOKEN`: the workflow keeps this as a GitHub secret; a
  local run supplies the equivalent read-only (Drafts) agent key from the
  production dashboard, used by the post-deploy smoke test

## Launch pricing in Polar (production)

Dev uses the Polar **sandbox** with the same setup; its ids are already in the
dev vars of `apps/api/wrangler.jsonc`.

1. Keep the products at the list price: monthly **$15**, yearly **$150**.
2. Create two discounts, duration **forever**, no code, each limited to its product.
   Fixed amounts give exact prices (percentages work too; the site shows percentages either way):
   - monthly: **$6 off** (40%) → $9/month
   - yearly: **$75 off** (50%) → $75/year
3. Add their ids to `apps/api/wrangler.jsonc` under `env.production.vars`:
   `POLAR_LAUNCH_DISCOUNT_MONTHLY_ID`, `POLAR_LAUNCH_DISCOUNT_YEARLY_ID`.
4. Optional live check (needs a read-only Polar token; the deploy skips it
   without one, and checkout refuses mismatched prices either way). Standalone
   mode reads your shell, so export all four ids:
   `POLAR_SERVER=production POLAR_ACCESS_TOKEN=… POLAR_MONTHLY_PRODUCT_ID=… POLAR_YEARLY_PRODUCT_ID=… POLAR_LAUNCH_DISCOUNT_MONTHLY_ID=… POLAR_LAUNCH_DISCOUNT_YEARLY_ID=… pnpm preflight:pricing`.
   The deploy's preflight reads the ids from `wrangler.jsonc`, not your shell.
   With a token, preflight refuses to deploy unless the products and discounts
   produce exactly the advertised prices. Without one, it only requires the
   discount ids in config; verify with a real checkout after deploying.

To end launch pricing later: remove the two vars and update `LAUNCH_OFFER` in
`packages/config`. Existing subscribers keep their discount.

## Legacy data (every deploy)

Preflight lists posts that migration 0021 would convert (scheduled posts,
published posts without version history) and blocks until you acknowledge the
exact set with the hashes it prints (`ACK_LEGACY_SCHEDULED_POSTS=<hash>`, `ACK_LEGACY_UNVERSIONED_POSTS=<hash>`). If the affected posts
change, the acknowledgement stops matching. These checks run on every
preflight, independent of the 0018 cutover below.

## When migration 0018 is still pending

This section applies only to a deploy where `d1 migrations list` still shows
`0018_post_published_version` pending — the one-time cutover that moves posts
to pinned, versioned public content. Once that migration has been applied,
the write freeze and pin steps below never re-trigger and the script skips them.

### 1. Write freeze

The old API can't be paused from the new code. For the ~2 minutes between the
migrations and the new API deploy (and across any failed attempts until the
cutover completes), **no one may publish or edit on production**: pause agents that use production keys and don't use the
dashboard. For this one-time upgrade the deploy asks you to confirm with
`CONFIRM_WRITE_FREEZE=1`; routine deploys afterwards don't ask.

### 2. Deploy

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

### 3. After

Reopen writes, then check a published post, a private preview link, a
scheduled post, and a checkout on both plans (the first charge should be $9 / $75).

## Known limits

- The write freeze is manual, and applies only when migration 0018 is
  pending (see above).
- A checkout retried before the first one completes can leave an extra open
  checkout link. Polar expires unused checkouts; no charge is made.
- The API and public Workers keep Cloudflare invocation logs disabled (they
  would record raw URLs, and preview links carry their token in the path).
  The OG Worker enables them — it has no public route. Our own API request
  and error logs redact `/preview/…`.

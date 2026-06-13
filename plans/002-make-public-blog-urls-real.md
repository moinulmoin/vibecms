# Plan 002: Make default public blog URLs real in hosted and self-host deployments

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c95b816..HEAD -- apps/web/src/server/onboarding.ts apps/web/src/server/public-blog.tsx apps/web/src/server/cms.ts apps/web/src/app/pages/dashboard.tsx docs/self-hosting.md README.md packages/config/src/index.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-add-launch-smoke-suite.md recommended
- **Category**: correctness
- **Planned at**: commit `c95b816`, 2026-06-10

## Why this matters

The product promises public hosted blog pages, but new sites currently store `slug.localhost` as their active default domain. In production, dashboards can show `https://<slug>.localhost`, while `resolveSite` ignores localhost and only resolves actual domain rows. A user can create and publish content, but their default public URL is not launchable without manual DB surgery.

A deployed smoke also showed the current remote Worker at `https://vibecms.moinulislammoin2019.workers.dev` is stale: it rendered old copy (`VibeCMS | Blog CMS for humans and AI agents`) and `/brand/og-image.png` returned 404, while current `main` has new copy/assets. That is a release-process issue, but this plan focuses on source behavior for real public URLs.

## Current state

- `ensureOnboarding` inserts `${siteSlug}.localhost` as the active default domain.
- `completeSiteSetup` updates the default domain to `${slug}.localhost`.
- `getDashboardData` displays the DB domain as `https://${domain.hostname}`.
- `resolveSite` ignores `localhost`, `APP_URL`, and `app.*`, then looks up `domains.hostname`.
- `PUBLIC_BLOG_DOMAIN` exists in env/config/docs but is not used for default domain creation.

Excerpts:

```ts
// apps/web/src/server/onboarding.ts:39-40
env.DB.prepare("INSERT OR IGNORE INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)")
  .bind(`domain_${user.id}`, siteId, `${siteSlug}.localhost`, timestamp, timestamp),
```

```ts
// apps/web/src/server/onboarding.ts:81-82
env.DB.prepare("UPDATE domains SET hostname = ?, updated_at = ? WHERE site_id = ? AND type = 'default'")
  .bind(`${slug}.localhost`, timestamp, app.siteId),
```

```ts
// apps/web/src/server/cms.ts:119-141
env.DB.prepare("SELECT hostname FROM domains WHERE site_id = ? AND type='default' AND status='active' LIMIT 1").bind(app.siteId),
...
publicUrl: domain ? `https://${domain.hostname}` : null,
```

```ts
// apps/web/src/server/public-blog.tsx:55-56
const host = normalizeHost(request);
if (!host || host === "localhost" || host === appHost() || host.startsWith("app.")) return null;
```

Repo conventions: server modules read Cloudflare env through `cloudflare:workers`; setup and dashboard use native forms and 303 redirects; no custom domain provisioning is in scope.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Public audit | `pnpm public:audit` | exit 0 |
| Smoke | `pnpm test:smoke:launch` | exit 0 if Plan 001 has landed |

## Scope

**In scope**:
- `apps/web/src/server/onboarding.ts`
- `apps/web/src/server/public-blog.tsx`
- `apps/web/src/server/cms.ts`
- `apps/web/src/app/pages/dashboard.tsx` only if public URL rendering needs copy tweaks
- `README.md`
- `docs/self-hosting.md`
- `docs/launch-rehearsal.md`

**Out of scope**:
- Custom domain verification/provisioning UI.
- Wildcard DNS automation outside source.
- Changing the product to path-based public blogs unless the wildcard-domain approach is impossible.
- Deploying to production without operator instruction.

## Git workflow

- Branch: `advisor/002-public-blog-urls`
- Commit message: `fix: make default public blog URLs deployable`
- Do not push unless instructed.

## Steps

### Step 1: Add a default public host helper

In `apps/web/src/server/onboarding.ts`, add a helper that builds the default hostname from `env.PUBLIC_BLOG_DOMAIN`.

Target behavior:

- In normal hosted/self-host deployed environments: `${slug}.${PUBLIC_BLOG_DOMAIN}`.
- In local dev when `PUBLIC_BLOG_DOMAIN` is `localhost` or missing: `${slug}.localhost` may remain for dev display, but docs/tests must acknowledge it is local only.
- Normalize by lowercasing and removing protocol/trailing slash if a user accidentally sets `PUBLIC_BLOG_DOMAIN` as a URL.

Add a small local helper, for example:

```ts
function defaultHostname(slug: string) {
  const base = env.PUBLIC_BLOG_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  if (!base || base === "localhost") return `${slug}.localhost`;
  return `${slug}.${base}`;
}
```

Use it in `ensureOnboarding` and `completeSiteSetup`.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 2: Update public-site resolution for default hostnames

Keep `resolveSite` host-based. Confirm it resolves the new default hostname row. Do not allow `APP_URL` or `app.*` to resolve as public blogs unless a deliberate product decision changes routing.

If needed, make `appHost()` and `normalizeHost()` robust against malformed `APP_URL`, but keep the current behavior of ignoring app hosts.

**Verify**: with local dev and `PUBLIC_BLOG_DOMAIN=localhost`, existing local behavior still works as before. With a test env where `PUBLIC_BLOG_DOMAIN=example.test`, onboarding should store `<slug>.example.test`.

### Step 3: Update dashboard display and docs

Dashboard currently reads the active domain and renders `https://${domain.hostname}`. That can stay if default hostnames are real. Update user-facing docs to state that default public URLs require wildcard routing/DNS for `*.PUBLIC_BLOG_DOMAIN` in hosted/self-host deployments.

Update:

- `README.md` self-host section.
- `docs/self-hosting.md` required variables and deploy notes.
- `docs/launch-rehearsal.md` to include a public blog URL smoke: create post, publish it, open `https://<siteSlug>.<PUBLIC_BLOG_DOMAIN>/<post-slug>`.

**Verify**: `pnpm public:audit` -> exit 0.

### Step 4: Add migration or compatibility note for existing `localhost` rows

If existing production/dev D1 may already contain `${slug}.localhost` rows, add a migration or admin note. Prefer a migration only if it can safely transform rows using the current `PUBLIC_BLOG_DOMAIN`; SQL migrations cannot read runtime env directly, so source-level migration may not fit.

Minimum acceptable for launch: document that existing alpha rows need default domain repair after deploy. Better: add an idempotent server-side repair during setup/dashboard load that updates active default domains ending in `.localhost` when `PUBLIC_BLOG_DOMAIN` is non-local.

**Verify**: smoke a migrated/legacy account with a `.localhost` default domain and confirm the dashboard shows a real default hostname.

## Test plan

- Extend Plan 001 smoke if available: after setup, assert the dashboard public URL does not contain `.localhost` when `PUBLIC_BLOG_DOMAIN` is non-local.
- Add a direct unit-style helper test if a test harness exists; otherwise cover with smoke.
- Manual deployed rehearsal: after deployment and DNS/wildcard routing, create a post and open the public URL.

## Done criteria

- [ ] New onboarding/setup domains use `${slug}.${PUBLIC_BLOG_DOMAIN}` outside local dev.
- [ ] Dashboard public URL is real outside local dev.
- [ ] Docs state DNS/wildcard/default-domain requirements clearly.
- [ ] Legacy `.localhost` rows have a documented or automatic repair path.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm public:audit` exit 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The deployment platform cannot route wildcard subdomains to the Worker.
- Product direction changes to path-based public blogs (`/sites/:slug`) instead of subdomains.
- Existing D1 data contains conflicting domain rows that cannot be repaired automatically.

## Maintenance notes

This is not custom domains. It only makes the default public URL real. Custom domain provisioning/verification remains a later feature and should build on the same `domains` table.
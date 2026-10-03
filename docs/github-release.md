# GitHub Release Checklist

Use this when cutting a vibecms GitHub release.

## Before tagging

```sh
pnpm public:audit
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm build:self-host
pnpm openapi:check
```

Then verify:

- no `.env` or `.dev.vars` files are tracked
- `CHANGELOG.md` has the release notes
- `README.md` deploy button URL matches the actual repository
- production/sandbox secrets have not been committed
- any secret exposed in chat, logs, screenshots, or old commits has been rotated
- the production workflow will receive the full 40-character SHA of this reviewed commit, not a branch or short SHA
- a first-deploy bootstrap uses a temporary `PRODUCTION_BOOTSTRAP_SHA` production environment secret equal to that commit, removed immediately after the deploy
- the credentialed production checklist in `docs/launch-runbook.md` has passed for the same release commit

## Tag the reviewed release

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Release notes skeleton

```md
## vibecms 0.1.0

First public V1 of vibecms: the publishing control plane for AI agents, with humans in control of every release.

### Included

- Hono API/dashboard Worker + Astro public-blog Worker on Cloudflare
- D1 database and R2 media
- Better Auth passwordless email OTP sign-in
- Exact Markdown editing, immutable versions, approval-bound publishing, activity history, and rollback
- Scoped MCP, typed REST/OpenAPI, and `@vibecms/cli` agent surfaces
- Curated public themes with a real published-version preview
- Managed AutoSEOPilot hosting integration
- Polar hosted billing
- `SELF_HOSTED=true` mode
- Root Deploy-to-Cloudflare configuration

### V1 boundaries

- Newsletter capture stores and exports pending subscribers; double opt-in and email delivery are not included yet
- Google and GitHub sign-in appear only when their OAuth credentials are configured; email OTP is the default
- Single blog per workspace; no teams, scheduled publishing, comments, or generic page builder

### Evidence required before making launch claims

- Verify one production custom domain end to end through Cloudflare for SaaS
- Verify the production AutoSEOPilot provision/rotate/revoke lifecycle across both systems
- Rehearse Deploy to Cloudflare from a clean public-repository path before promoting self-hosting
```

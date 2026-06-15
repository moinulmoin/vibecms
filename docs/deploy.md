# VibeCMS - deployment and branch model

How code reaches Cloudflare. Two paths: manual (`pnpm deploy:*`) and push-to-deploy
(Cloudflare Workers Builds). The production launch config (secrets, domain, Polar, Resend)
lives in [`launch-runbook.md`](./launch-runbook.md); this doc is about *how a push becomes
a deploy* and how branches map to Workers.

## Branch -> Worker model

A Cloudflare Worker connects to **one** Git branch. Pushing that branch deploys that
Worker. Other branches do **not** create new Workers - if you enable non-production branch
builds, a push uploads a **preview version of the same Worker** (a preview URL, never a
promotion). To run separate environments you connect **separate Workers**, one per branch:

| Branch | Worker | URL | Role |
|---|---|---|---|
| `dev` | `vibecms` | `https://vibecms.moinulislammoin2019.workers.dev` | development (active) |
| `main` | `vibecms-prod` (created at launch) | custom domain | production |

`dev` is the working branch: changes land and deploy there first. `main` is promoted by
merging `dev -> main` once verified, and only deploys once its own Worker exists.

> Cloudflare does not auto-create a Worker per branch. `main` is just a git branch with
> nothing attached until you create the prod Worker and connect it to `main`.

## Push-to-deploy (Workers Builds)

RedwoodSDK is a Vite plugin. Locally, the canonical build+deploy is the `release` script in
`apps/web/package.json` (`ensure-deploy-env -> clean -> vite build -> wrangler deploy`),
exposed at the repo root as `release:dev`. **Do not use `release` in Workers Builds.** Its
`ensure-deploy-env` step is an interactive first-time-setup helper: it prompts
`Do you want to proceed with deployment? (y/N)`, creates a temp secret, and runs D1/auth
setup - all of which hang or bail in a non-interactive CI runner. For CI, build and deploy
explicitly instead.

Set up once per Worker: **Workers & Pages -> the Worker -> Settings -> Build -> Connect**,
authorize GitHub, pick `moinulmoin/vibecms`, then:

| Setting | Value | Why |
|---|---|---|
| Git branch | `dev` (prod Worker: `main`) | the branch this Worker deploys |
| Root directory | *blank (repo root)* | pnpm workspace - install must run at root so the `@vc/*` packages resolve |
| Build command | `pnpm build` | `vite build` (RedwoodSDK) |
| Deploy command | `pnpm --filter @vc/web exec wrangler deploy` | deploys the built worker via the redirected config |
| Non-prod branch deploy *(optional)* | `pnpm --filter @vc/web exec wrangler versions upload` | preview URLs for other branches |

Workers Builds runs the install step itself, uses the wrangler version pinned in
`package.json` (`4.85.0`), and `wrangler deploy` picks up the redirected config the build
emits at `apps/web/dist/worker/wrangler.json`. This split is exactly what manual
`deploy:dev` does (minus migrations); `release` / `release:dev` stays the local manual path.

### D1 migrations are not in the CI deploy

The build+deploy above only builds and deploys. The API token Workers Builds auto-creates
has Workers / KV / R2 edit but **no D1** permission, so migrations cannot ride along by
default. On a schema change, either:

- run `pnpm db:migrate:dev` yourself (locally, after `wrangler login`) before the push, or
- create a custom user API token **with D1 edit**, select it under Build settings, and
  prepend the migrate to the deploy command:
  `pnpm --filter @vc/web exec wrangler d1 migrations apply DB --remote && pnpm --filter @vc/web exec wrangler deploy`

Migrations are additive and idempotent, so re-applying is a no-op and safe to run ahead of
a deploy.

### Secrets and vars

Runtime secrets (`BETTER_AUTH_SECRET`, `TOKEN_PEPPER`, `RESEND_API_KEY`, Polar, Google)
live **on the Worker** (`wrangler secret put`) and persist across deploys - CI does not
need `.dev.vars`. Non-secret vars (`APP_ENV`, `APP_URL`, ...) live in
`apps/web/wrangler.jsonc`. Full production set: [`launch-runbook.md`](./launch-runbook.md).

## Manual deploy (fallback, and the first prod release)

Always available, no Git connection required:

```bash
pnpm deploy:dev    # dev worker: migrate remote DB -> build -> deploy
pnpm deploy:prod   # prod worker: migrate remote DB -> build -> deploy (see launch-runbook.md)
```

Both apply D1 migrations to the remote `DB` binding, then build and deploy. The first
production release is done manually with `pnpm deploy:prod` per the launch runbook; connect
the prod Worker to `main` for push-to-deploy afterward.

## CI checks (separate from deploy)

`.github/workflows/ci.yml` runs `public:audit -> typecheck -> lint -> build` on PRs and on
push to `main`. It does **not** deploy. It coexists with Workers Builds: Actions gates
correctness, Workers Builds ships. Add `dev` to its `push.branches` if you want the same
checks on direct pushes to `dev`.

# Plan 001: Add a launch smoke suite that covers the real contract

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c95b816..HEAD -- package.json .github/workflows/ci.yml scripts/smoke-local.sh scripts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `c95b816`, 2026-06-10

## Why this matters

The repo currently has strong type/build gates, but almost no behavioral coverage. During audit, a manual local smoke succeeded for signup, setup, UI draft creation, token creation, MCP `tools/list`, MCP `posts.create`, MCP `posts.publish`, REST `GET /api/posts`, and JSON export. That contract should be automated before more launch fixes land, otherwise changes to auth, public URLs, MCP, billing, or exports can regress while CI stays green.

## Current state

- `.github/workflows/ci.yml` runs install, `pnpm public:audit`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`, but no smoke/e2e step.
- `package.json` exposes `test:smoke` only, wired to a hosted-billing smoke.
- `scripts/smoke-local.sh` covers signup/setup and expects hosted billing redirect only.

Relevant excerpts:

```yaml
# .github/workflows/ci.yml:29-39
- name: Public release audit
  run: pnpm public:audit

- name: Typecheck
  run: pnpm typecheck

- name: Lint
  run: pnpm lint

- name: Build
  run: pnpm build
```

```json
// package.json:47-50
"deploy": "pnpm build:self-host && pnpm db:migrate:self-host:remote && pnpm --filter @vc/web exec wrangler deploy --config dist/worker/wrangler.json",
"deploy:dev": "pnpm build && pnpm --filter @vc/web exec wrangler deploy",
"public:audit": "bash scripts/public-release-audit.sh",
"test:smoke": "bash scripts/smoke-local.sh"
```

```bash
# scripts/smoke-local.sh:19-24
APP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}:%{redirect_url}' -b "$COOKIE_JAR" "$BASE_URL/app")
case "$APP_STATUS" in
  302:*"/app/billing"|303:*"/app/billing") ;;
  *) echo "expected /app to redirect to /app/billing, got $APP_STATUS" >&2; exit 1 ;;
esac
curl -fsS -b "$COOKIE_JAR" "$BASE_URL/app/billing" >/dev/null
```

Repo conventions: root scripts use `pnpm` and Bash for release checks. Keep smoke scripts deterministic, no external production services, no payment/Polar checkout, and no secrets printed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Public audit | `pnpm public:audit` | exit 0, `public-release audit ok` |
| Smoke | `pnpm test:smoke:launch` | exit 0, prints `launch smoke ok` |

## Scope

**In scope**:
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/smoke-local.sh`
- `scripts/smoke-launch.mjs` or `scripts/smoke-launch.sh` (create)
- `scripts/smoke-self-host.sh` (optional if you split hosted/self-host Bash scripts)

**Out of scope**:
- App source behavior fixes. This plan should characterize current behavior, not change product logic.
- Remote production smoke against `vibecms.moinulislammoin2019.workers.dev`. Keep CI local.
- Real Polar checkout or payment flows.

## Git workflow

- Branch: `advisor/001-launch-smoke-suite`
- Commit message style: conventional commits, e.g. `test: add launch smoke suite`
- Do not push unless instructed.

## Steps

### Step 1: Add a local launch smoke script

Create `scripts/smoke-launch.mjs` using Node 22 built-in `fetch`, `FormData`, and cookie handling. It should accept `BASE_URL`, defaulting to `http://localhost:5173`.

The script must cover:

1. `GET /` returns 200 and includes the current title/copy.
2. `POST /api/auth/sign-up/email` creates a unique account.
3. `POST /api/onboarding/ensure` returns 200.
4. `POST /app/setup/complete` redirects.
5. `GET /app` returns 200 in `SELF_HOSTED=true` local dev or redirects to `/app/billing` in hosted mode; make the expected mode explicit with `SMOKE_MODE=hosted|self-host`.
6. In self-host mode only: create a UI draft with `/app/posts/create` and assert it appears on `/app/posts`.
7. In self-host mode only: create a scoped token through `/app/settings/api-keys/create`, parse the one-time flash cookie, call MCP `initialize`, MCP `tools/list`, MCP `posts.create`, MCP `posts.publish`, REST `GET /api/posts`, and `/app/export.json`. Assert export JSON does not contain the token string.

Prefer a single script with `SMOKE_MODE` branches over duplicating logic.

**Verify**: `BASE_URL=http://localhost:5173 SMOKE_MODE=self-host pnpm test:smoke:launch` after starting local dev with self-host env -> exit 0, prints `launch smoke ok`.

### Step 2: Keep or narrow the existing hosted smoke

Keep `scripts/smoke-local.sh` if useful, but rename or document it as hosted-billing smoke. It currently expects `/app` to redirect to `/app/billing`; that is correct only for hosted mode before checkout.

Add package scripts:

```json
"test:smoke:hosted": "bash scripts/smoke-local.sh",
"test:smoke:launch": "node scripts/smoke-launch.mjs"
```

Leave existing `test:smoke` as an alias to the launch smoke or hosted smoke, but make the name clear in README if changed.

**Verify**: `pnpm test:smoke:launch --help` or equivalent no-server usage should print clear usage without stack traces if you implement a help branch. If no help branch, run with local dev and verify success.

### Step 3: Wire smoke into CI carefully

Add a CI smoke step only if it can start the app and local D1/R2 reliably without remote resources. If Cloudflare local dev cannot be made stable in CI in this plan, do not add the CI step yet. Instead, update `docs/launch-rehearsal.md` to require the new smoke command until a future CI plan wires it.

If adding CI, run the app in background with the existing local env/example setup and wait for `/` before running the smoke. Ensure the job terminates the dev server.

**Verify**: `pnpm typecheck && pnpm lint && pnpm build && pnpm public:audit` -> all pass.

## Test plan

- The smoke script is the test. It should fail on non-200 homepage, failed signup/setup, missing dashboard, failed token creation, missing MCP tools, failed MCP publish, REST read failure, or export token leakage.
- Run both modes manually when possible:
  - `SMOKE_MODE=hosted pnpm test:smoke:launch`
  - `SMOKE_MODE=self-host pnpm test:smoke:launch`

## Done criteria

- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm lint` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `pnpm public:audit` exits 0.
- [ ] New launch smoke script exists and documents `BASE_URL` + `SMOKE_MODE`.
- [ ] Smoke covers signup/setup, UI post creation, token creation, MCP create/publish, REST read, and export leak check in self-host mode.
- [ ] Existing hosted billing smoke is either preserved or clearly renamed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The local dev server cannot be started deterministically in CI without remote Cloudflare resources.
- Better Auth response/cookie shape differs from the current script assumptions and would require app source changes.
- Smoke coverage requires touching app source files; that belongs in a separate fix plan.

## Maintenance notes

This smoke suite becomes the guardrail for the rest of the launch plans. When new MCP tools, public URL behavior, or import/export features land, extend this script before changing implementation.
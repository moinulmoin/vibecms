# Plan 003: Add CSRF protection to session-authenticated mutations

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c95b816..HEAD -- apps/web/src/worker.tsx apps/web/src/app/pages apps/web/src/server packages/ui/src/components/confirm-submit.tsx`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-add-launch-smoke-suite.md recommended
- **Category**: security
- **Planned at**: commit `c95b816`, 2026-06-10

## Why this matters

VibeCMS uses session-authenticated native POST forms for setup, posts, media upload, billing checkout/portal, token creation/revoke, and theme updates. Those forms currently have no anti-CSRF token. If Better Auth's session cookie is sent on a cross-site form submission, another site could trigger mutations such as publish/archive, token creation/revoke, or checkout redirects in the user's browser.

Bearer-token MCP/REST routes are not the problem because attackers cannot attach the victim's bearer token from another origin. This plan only protects browser-session mutations.

## Current state

- `worker.tsx` loads the Better Auth session into `ctx.app` for all routes.
- App mutation routes are plain POST routes under `/app/...`.
- Forms in settings/posts/setup/media do not include a CSRF hidden input.
- `ConfirmSubmit` is client-only; without JS, destructive submits degrade to one click.

Excerpts:

```ts
// apps/web/src/worker.tsx:106-110
async ({ ctx, request }) => {
  ctx.authUrl = env.BETTER_AUTH_URL;
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user) {
    ctx.app = await ensureOnboarding({ id: session.user.id, name: session.user.name, email: session.user.email });
  }
},
```

```ts
// apps/web/src/worker.tsx:141-180
route("/app/setup/complete", { post: ({ ctx, request }) => completeSiteSetup(requireApp(ctx), request) }),
route("/app/posts/create", { post: async ({ ctx, request }) => createPostFromRequest(await requireBillableApp(ctx), request) }),
route("/app/posts/:postId/publish", { post: async ({ ctx, request, params }) => publishPostFromRequest(await requireBillableApp(ctx), params.postId, request) }),
route("/app/settings/api-keys/create", { post: async ({ ctx, request }) => { ... } }),
route("/app/settings/appearance", { post: ({ ctx, request }) => updateSiteTheme(requireApp(ctx), request) }),
```

```tsx
// apps/web/src/app/pages/settings.tsx:73-90
<form className="grid gap-4" method="post" action="/app/settings/appearance">
  ...
</form>
```

```tsx
// packages/ui/src/components/confirm-submit.tsx:38-45
const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
  onClick?.(event);
  if (event.defaultPrevented) return;
  if (!armed) {
    event.preventDefault();
    setArmed(true);
    requestAnimationFrame(() => ref.current?.focus());
  }
};
```

Repo conventions: prefer native forms and 303 redirects. Do not convert app actions to JSON APIs just to add CSRF.

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
- `apps/web/src/worker.tsx`
- `apps/web/src/server/*` only where mutation handlers need token verification
- `apps/web/src/app/pages/*.tsx` forms that POST under `/app`
- `packages/ui/src/components/confirm-submit.tsx` only if it needs to carry a hidden confirm/CSRF field
- A new CSRF helper module such as `apps/web/src/server/csrf.ts` or `apps/web/src/app/csrf.tsx`

**Out of scope**:
- `/mcp` bearer-token route.
- `/api/posts` bearer-token route.
- `/polar/webhook`, which is signed by `POLAR_WEBHOOK_SECRET`.
- Replacing Better Auth.
- Implementing OAuth for MCP.

## Git workflow

- Branch: `advisor/003-csrf-protection`
- Commit message: `security: add csrf protection to app forms`
- Do not push unless instructed.

## Steps

### Step 1: Choose and implement one CSRF mechanism

First inspect Better Auth docs/source for built-in CSRF support in this stack. If it provides a supported CSRF token API for native forms, use it.

If no suitable built-in exists, implement a double-submit token:

- Generate a cryptographically random token for authenticated app pages.
- Set it in an `HttpOnly` or signed cookie if feasible. If the server must render the same token into a hidden field, use an HMAC-signed token generated from `TOKEN_PEPPER` and a per-session/random nonce.
- Render `<input type="hidden" name="csrfToken" value="..." />` in every app form.
- Verify token on every session-authenticated non-idempotent route before mutation.

Keep the API simple, e.g.:

```ts
// shape only; adapt to actual implementation
export function csrfField(request: Request): React.ReactNode;
export async function verifyCsrf(request: Request): Promise<void>;
```

**Verify**: `pnpm typecheck` -> exit 0.

### Step 2: Wire verification into app mutation routes

Add verification before all session-authenticated mutations:

- `/app/setup/complete`
- `/api/onboarding/ensure` if it remains cookie-session POST
- `/app/posts/create`
- `/app/posts/:postId/update`
- `/app/posts/:postId/publish`
- `/app/posts/:postId/archive`
- `/app/media/upload`
- `/app/billing/checkout`
- `/app/billing/portal`
- `/app/settings/api-keys/create`
- `/app/settings/api-keys/:keyId/revoke`
- `/app/settings/appearance`
- `/app/settings/token-created/clear` if it remains a browser-session mutation

Return a 403 or redirect with an allowlisted `error=csrf` code. Match existing form-status patterns from `@vc/config`.

**Verify**: run a manual POST without token to one low-risk route such as `/app/settings/appearance`; expect 403 or allowlisted error redirect.

### Step 3: Add CSRF fields to all native forms

Update the pages/components that render forms:

- `setup.tsx`
- `post-editor.tsx`
- `posts.tsx`
- `media.tsx`
- `settings.tsx`
- `billing-required.tsx`
- any token-created clear form if applicable

Keep styling untouched. The hidden input must be inside each `<form>`.

**Verify**: `pnpm typecheck && pnpm lint` -> exit 0.

### Step 4: Preserve progressive enhancement and no-JS behavior

Confirm native form submissions still work with CSRF token. Do not make legitimate POSTs depend on client-side JavaScript.

If addressing destructive no-JS confirmation in this plan, make server routes require an explicit confirmation field for archive/revoke, and let `ConfirmSubmit` add/enable it on second click. If that grows beyond this plan, leave it as a separate follow-up and do not block CSRF on it.

**Verify**: launch smoke from Plan 001, or manual signup/setup/post-create/token-create, still passes.

## Test plan

- Add smoke coverage if Plan 001 exists:
  - legitimate forms with CSRF succeed.
  - missing CSRF on `/app/posts/create` fails.
  - bearer MCP `tools/list` and `tools/call` still work without CSRF.
- If no test harness exists yet, add these cases to `scripts/smoke-launch.mjs` rather than creating a full framework.

## Done criteria

- [ ] Every session-authenticated non-idempotent app route verifies CSRF.
- [ ] Every native app form includes the CSRF field.
- [ ] Bearer-token MCP/REST and signed Polar webhook are not required to send CSRF.
- [ ] Legitimate no-JS native forms still submit successfully.
- [ ] Missing/invalid CSRF returns stable 403 or allowlisted form error.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm public:audit` exit 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Better Auth already enforces CSRF for these routes in a way not visible from app code. Provide evidence and do not duplicate protection.
- The chosen CSRF design would require exposing `TOKEN_PEPPER` or any secret to the client.
- Adding CSRF breaks Better Auth's own `/api/auth/*` handlers; those are out of scope.

## Maintenance notes

Every future browser-session POST route must include CSRF verification and a rendered hidden field. Add this requirement to any future `AGENTS.md`/contributor docs so agent executors do not add unprotected forms.
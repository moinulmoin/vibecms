# Build Milestones

This is the execution plan I will follow without requiring per-step nitpicks. Each milestone must preserve the product rule: human UI and agent/API access share the same core commands, mutations create activity, and meaningful post changes create versions.

## M0, Foundation scaffold — done

Acceptance:

- RedwoodSDK app boots and builds.
- pnpm workspace exists for web, core, db, validators, mcp, ui, config.
- D1/R2 bindings are declared.
- Core actor/scope types, validators, policy checks, post command contracts, and schema exist.

## M1, Local D1 post vertical slice — done

Acceptance:

- Local D1 migration applies.
- Seed creates one workspace, one site, one draft post, one published post.
- Dashboard/post list reads from D1.
- Create, update, publish, and archive go through `@vc/core` commands.
- Each post mutation writes activity and a post version.

## M2, Public blog rendering — done

Acceptance:

- Host/site resolver can find a site from default domain rows.
- Blog index renders only published posts.
- Post detail renders only published posts by slug.
- Draft, scheduled future, archived, and unknown posts return 404.
- Markdown rendering is sanitized.

## M3, Authentication and onboarding — done

Acceptance:

- Human signup/login/logout works.
- Signup/onboarding creates workspace, owner membership, site, default domain, and activity.
- `/app` requires auth.
- Core commands authorize by membership role.

## M4, API keys and token auth — done

Acceptance:

- Owners can create/revoke tokens.
- Raw token is shown once; only hash plus prefix is stored.
- Default scopes exclude `posts:publish`.
- Bearer token auth maps to an API-key actor.
- Revoked/missing-scope tokens fail.

## M5, MCP endpoint — done

Acceptance:

- `/mcp` exposes the planned CMS tools.
- Tools call the same core commands as the UI.
- Read/write/publish scopes are enforced.
- Mutating tool calls create activity and versions where appropriate.

## M6, Media via R2 — done

Acceptance:

- Images upload to R2 with D1 asset metadata.
- MIME and 5MB limits are enforced.
- Media can be used as post cover image.
- Media writes create activity.

## M7, Billing gate — done

Acceptance:

- Polar checkout, portal, and webhooks work.
- Billing state is stored idempotently.
- Publish is blocked for disallowed billing states.
- Owner-only billing access is enforced.

## M8, Launch hardening — done

Acceptance:

- Cross-site access tests pass.
- Public rendering tests pass.
- API/MCP authz tests pass.
- Deploy configuration is production-ready.
- Custom domains are either shipped or explicitly deferred.

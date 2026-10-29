# 029 — Sign in with vibecms: OAuth for agents

Status: SHIPPED 2026-10-28 (founder approved "build it all" the same day). Built with these deltas from the proposal below: a grant is an `api_keys` row with `oauth_client_id` (no separate grants table, so scopes, quotas, activity, the 10-per-blog cap and Disconnect reuse the key machinery); access tokens last 1 hour; refresh tokens rotate and each lasts 30 days from issue; a rotated refresh token reused within 60 seconds gets `invalid_grant` without revocation (lost-response grace), later reuse revokes the family and the connection; insufficient scope keeps the existing HTTP 200 `isError` FORBIDDEN result; consent lives at the dashboard route `/authorize`. CIMD trusts only `claude.ai` and `chatgpt.com` hosts. ChatGPT and Cursor sign-in remain untested and unadvertised.
Date: 2026-10-23 (design), 2026-10-28 (built). Repository baseline: `6b6a63f`.

## Founder reversal — 2026-10-29

Sign-in happens up front, not lazily on the first account tool call. This decision supersedes the original public MCP discovery/listing policy below: valid requests to `initialize`, `tools/list`, modern `server/discover`, and legacy `notifications/initialized` require a bearer credential, as do tool calls. Without one, return HTTP `401`, JSON-RPC `-32001`, and `WWW-Authenticate: Bearer resource_metadata="https://app.vibecms.dev/.well-known/oauth-protected-resource/mcp"` without `error="invalid_token"`; invalid or expired bearers retain the `invalid_token` challenge. OAuth-capable clients such as Claude web, desktop and Code should offer **Connect** or **Sign in** before tools become available. Existing agent keys and valid OAuth connections keep their permissions and behavior.

The `2026-07-28` specification's **Access Token Usage** requires authorization on every request. `server/discover` response caching is not a public-access exemption: its authenticated success keeps `cacheScope: "public"` because the response is identical across principals. `tools/list` remains scope-filtered with private caching.

OAuth protected-resource/authorization-server metadata, trusted CIMD and public-client DCR remain public, as do the static MCP server card and HTTP agent skill files. Anonymous directory scanners now receive the sign-in challenge rather than a tool inventory; use OAuth or a dedicated least-privilege test key where the directory supports it. Anonymous enumeration is no longer supported.

## What the user sees

1. **In Claude, ChatGPT, or Cursor:** add `https://app.vibecms.dev/mcp`, then choose **Connect**. No API key to find or paste.
2. **Sign in to vibecms:** our existing email-code sign-in screen, only if not already signed in. The agent never receives the email code or dashboard session.
3. **Allow Claude to connect to vibecms:** one screen showing the app name and identity host, the return hostname, **Blog** (choose exactly one), and **Access** (choose exactly one: **Write drafts**, **Write and publish**, **Manage**). Default: **Write drafts**. Explain each level in ordinary language, including that Write drafts cannot publish and Manage includes destructive permissions. Buttons: **Cancel** and **Allow**. For a local callback, show **Returns to localhost — a program on your computer will receive this connection**. If there are no eligible blogs, show **Create a blog first**; do not grant account-wide access.
4. **Back in the agent:** the connection is ready. Publishing still follows our approval-first agent instructions; permission to publish is not approval of a particular post.
5. **Dashboard → Connect:** a **Connections** list beside API keys: **Claude · My blog · Write drafts · Connected [date] · Last used [date] · Disconnect**. Disconnect confirmation: **Disconnect Claude? It will lose access immediately. Your posts will not be deleted.** Success: **Claude disconnected**. Keys remain available for scripts and the CLI.

These are proposed vibecms screens and copy, not claims about host-client UI labels. No new editor, account identity provider, or agent is being built.

## Decision requested

**Recommend a small, deliberately bounded OAuth authorization server in our Hono API, using existing Better Auth sessions for human sign-in and D1 for grants and opaque tokens.** Support authorization code + S256 PKCE, rotating refresh tokens, CIMD for explicitly trusted Claude/ChatGPT metadata URLs, and public-client DCR for Cursor/older clients. Keep existing API keys unchanged. Do not build OIDC identity claims, client credentials, device login, arbitrary CIMD URL fetching, or enterprise SSO in this change.

This is more protocol maintenance than adopting a current provider. It is recommended here because the installed Better Auth plugins are not the current documented provider, and the current CIMD package requires a network transport that Workers' ordinary fetch cannot supply. A narrow trusted-host CIMD policy and D1-backed opaque credentials fit the existing deployment and instant revocation without an auth-stack/SDK migration. This is not a claim that hand-written OAuth is generally safer. Security review and the acceptance scenarios below are release gates.

## Original repository baseline (2026-10-23)

The implementation references below record the pre-OAuth baseline, not current behavior. The 2026-10-29 founder reversal above supersedes its public MCP discovery/listing policy. OAuth produces the same internal agent identity and authorization decisions as a key; it must not establish a parallel permission system.
- MCP and REST share `authenticateBearerToken`: it reads an `Authorization: Bearer` credential, hashes it with HMAC-SHA256 and `TOKEN_PEPPER`, rejects missing/revoked database records, records last use, and returns the stored site/workspace plus an API-key actor. Generated keys use `vc_live_` plus random bytes; raw keys are shown at creation, not persisted. See [`api-keys.ts:45–66,230–253`](../apps/api/src/server/api-keys.ts).
- Keys are site-bound (`siteId` on creation), not account-wide. Only a human workspace owner can manage them; revocation is scoped to the current site and records activity. See [`api-keys.ts:37–42,124–176`](../apps/api/src/server/api-keys.ts) and [`schema.ts`](../packages/db/src/schema.ts).
- Today's Connect choices are **Write drafts**, **Write and publish**, **Manage**. The exact scope expansions are below, from [`types.ts:101–109`](../packages/core/src/types.ts); labels/descriptions and legacy recognition are in [`ConnectPage.tsx:31–42`](../apps/dashboard/src/components/dashboard/ConnectPage.tsx). Manage is not unrestricted: billing, keys and blog deletion stay human-only. Legacy `full` keys include `assets:delete` but do not include `site:write`; do not equate legacy Full access with Manage.

  | Level | Exact domain scopes |
  |---|---|
  | Write drafts (`draft`) | `sites:read posts:read posts:create posts:update assets:write activity:read` |
  | Write and publish (`publish`) | Write drafts plus `posts:publish` |
  | Manage (`manage`) | Write and publish plus `posts:archive site:write analytics:read` (not `assets:delete`) |

- `DEFAULT_SCOPES` is draft. Shared [`policies.ts`](../packages/core/src/policies.ts) checks actor scopes; [`operations.ts`](../packages/api-contract/src/operations.ts) defines operation requirements. Site IDs come from authenticated context rather than a caller-selected target.
- [`usage.ts:190–207`](../apps/api/src/server/usage.ts) enforces workspace minute/day/month calls, per-token minute calls and workspace write counters, using effective plan limits. Unlimited Cloud monthly allowances do not mean unlimited bursts. It supplies retry/rate headers in the same file. The existing self-hosted bypass remains unchanged.
- Actors carry key ID/name/scopes into core mutations and activity; `actorName` is used for ordinary keys and the key name for `site:write` keys. See [`api-keys.ts:246–250`](../apps/api/src/server/api-keys.ts), [`schema.ts`](../packages/db/src/schema.ts) (`api_keys`, `activity_events`).
- REST auth/errors are in [`server/api/app.ts`](../apps/api/src/server/api/app.ts). At the original baseline, MCP [`server/mcp.ts`](../apps/api/src/server/mcp.ts) allowed public tool listing when no bearer was supplied and returned missing/invalid credential HTTP 401s without `WWW-Authenticate`. **Superseded 2026-10-29:** MCP discovery/listing now requires authentication up front, with a sign-in challenge; authenticated tool listing remains scope-filtered and all account tool calls remain protected.

## Current client requirements

Sources were read on 2026-10-23. Each cited requirement is from current vendor documentation, not a promise that we have exercised it. `[CHECK]` means the documentation does not establish the detail or live compatibility remains to be confirmed.

### Claude: required first target

Sources: [authentication](https://claude.com/docs/connectors/building/authentication.md), [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md), [submission](https://claude.com/docs/connectors/building/submission.md).

- Sign-in starts on an HTTP **401**, not an HTTP 200 containing an MCP tool error. Return `WWW-Authenticate: Bearer resource_metadata="https://app.vibecms.dev/.well-known/oauth-protected-resource/mcp"`. This is a Bearer **challenge**, not a token value. Claude ignores that header on 200. Put the rejection before the MCP transport/SDK runs. ([Authentication](https://claude.com/docs/connectors/building/authentication.md), [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md))
- Serve RFC 9728 metadata at the path-suffixed URL and root alias. Set `resource` to exactly `https://app.vibecms.dev/mcp` (including `/mcp`) and put our sole issuer first in `authorization_servers`; Claude uses only the first issuer. Serve reachable RFC 8414 authorization-server metadata. Do not let WAF rules block discovery/registration/token traffic; Claude documents egress `160.79.104.0/21`. ([Authentication](https://claude.com/docs/connectors/building/authentication.md))
- Support DCR or CIMD. Claude chooses CIMD only when AS metadata contains both `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported` containing `none`; otherwise it falls back to DCR. Prefer CIMD to avoid a new DCR record for every fresh Claude connection. Public clients have no secret. ([Authentication](https://claude.com/docs/connectors/building/authentication.md))
- Require S256 PKCE on every authorization, advertise `code_challenge_methods_supported: ["S256"]`, rotate public-client refresh tokens, and return the replacement when consuming the old token. Invalid refresh tokens return `invalid_grant`. Accept `application/x-www-form-urlencoded` at the token endpoint; DCR accepts JSON. ([Authentication](https://claude.com/docs/connectors/building/authentication.md))
- Hosted callback: exactly `https://claude.ai/api/mcp/auth_callback`. Claude Code declares `http://localhost/callback` and `http://127.0.0.1/callback` in `https://claude.ai/oauth/claude-code-client-metadata`; ignore only the port when comparing these registered loopback callbacks. Keep scheme, host, path and query matching; do not accept arbitrary localhost paths. Display the callback hostname and warn for loopback-only clients. ([Authentication](https://claude.com/docs/connectors/building/authentication.md), [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md))
- Discovery, registration and initial token responses must arrive within **10 seconds**; refresh within **30 seconds**. Aim for under one second for local D1-backed endpoints; give trusted metadata fetching a short bounded deadline within that budget. Claude can refresh five minutes before expiry. Discovery changes may take approximately five minutes to propagate. ([Authentication](https://claude.com/docs/connectors/building/authentication.md), [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md))
- Lazy auth was considered optional in the original proposal. **Superseded 2026-10-29:** require sign-in up front for MCP discovery/listing as well as account tool calls, using a transport-level challenge. Do not add public account data just to copy the example. Do not silently step up a Write drafts grant after a failed publish; return permission denied and require an explicit new consent. ([Lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md))

### ChatGPT apps/connectors

Source: [OpenAI authentication guide](https://developers.openai.com/apps-sdk/build/auth) (currently redirects to [plugins/build/auth](https://developers.openai.com/plugins/build/auth)).

- OAuth 2.1 authorization code + S256, protected-resource and AS discovery, and `resource` binding across authorize/token/access-token verification are required. ChatGPT prefers CIMD when available, also supports DCR and predefined clients, and supports public CIMD clients with `none`. Publish only token authentication methods actually implemented. ([Guide](https://developers.openai.com/plugins/build/auth))
- Implement RFC 9207: advertise `authorization_response_iss_parameter_supported: true` and return the exact issuer as `iss` in successful and error authorization responses sent to a validated callback. This enables stable ChatGPT CIMD `https://chatgpt.com/oauth/client.json` and callback `https://chatgpt.com/connector_platform_oauth_redirect`. Otherwise ChatGPT uses connection-specific metadata and `https://chatgpt.com/connector/oauth/{callback_id}`. Copy the exact callback shown in its management page; never allow a wildcard for `{callback_id}`. ([Guide](https://developers.openai.com/plugins/build/auth))
- CIMD can publish plural `token_endpoint_auth_methods_supported` plus legacy singular preference. Accept `none` when it is in the supported intersection, even if the legacy preference is `private_key_jwt`; we do not implement private-key assertions initially. Reject incompatible clients rather than advertising unsupported methods. ([Guide](https://developers.openai.com/plugins/build/auth))
- Do not advertise `openid`, `email`, or `profile`: ChatGPT requests advertised OIDC scopes by default. Enterprise domain restrictions require OIDC, a UserInfo endpoint and verified email; these are explicitly outside this proposal, not supported by accident. `id_token_hint` optimization is optional. ([Guide](https://developers.openai.com/plugins/build/auth))
- `[CHECK]` Exercise the stable CIMD/public-client path in the current ChatGPT builder, tool auth declarations, refresh behavior, and the precise callback shown for our connection. Do not infer Claude's latency limits or loopback behavior apply to ChatGPT. ([Guide](https://developers.openai.com/plugins/build/auth))

### Cursor

Source: [Cursor MCP documentation](https://cursor.com/docs/context/mcp) (currently redirects to [docs/mcp](https://cursor.com/docs/mcp)).

- Remote SSE and Streamable HTTP support OAuth. Cursor documents authorization code + PKCE, RFC 9728 discovery, RFC 8707 resource indicators, and DCR public clients without a secret. It renews access tokens using refresh tokens; without one, expiry requires sign-in again. Advertise `offline_access` and issue refresh tokens only when requested and consented. ([MCP docs](https://cursor.com/docs/mcp))
- Documented fixed callbacks: web/Agents `https://www.cursor.com/agents/mcp/oauth/callback`, desktop `http://localhost:8787/callback`. DCR may register both and desktop may use the web handoff. Static `auth.CLIENT_ID`, optional `CLIENT_SECRET`, and `scopes` configuration are supported as a fallback, but should not be necessary for the default DCR path. ([MCP docs](https://cursor.com/docs/mcp))
- `[CHECK]` Cursor's page does not confirm CIMD support, a specific S256 advertisement requirement, refresh replay behavior or endpoint timeouts. Keep DCR, require S256 ourselves, and exercise desktop plus hosted callbacks before claiming compatibility. ([MCP docs](https://cursor.com/docs/mcp))

## Provider options: installed software is not current documentation
### Better Auth 1.6.26 already installed

Installed `apps/api/node_modules/better-auth/package.json` resolves **1.6.26** ([app manifest](../apps/api/package.json) requests `^1.6.26`). Inspected local distribution paths under `apps/api/node_modules/better-auth/dist/plugins` include `mcp`, `oidc-provider` and `jwt`, but no `oauth-provider` directory. Our [`server/auth.ts`](../apps/api/src/server/auth.ts) uses the SQLite Drizzle adapter and `emailOTP`; neither OAuth provider plugin is enabled.

The installed `mcp/index.mjs` exposes protected resource metadata, `/mcp/authorize`, `/mcp/token`, `/mcp/register` and `/mcp/userinfo`. Its shared `oidc-provider/schema.mjs` requires `oauthApplication` (client identity, redirects, secret/type/disabled/user), `oauthAccessToken` (access/refresh values, expiries, client/user/scopes), and `oauthConsent` (client/user/scopes/consent). These tables are absent from our current [`schema.ts`](../packages/db/src/schema.ts); enabling a plugin without a migration is not enough.

Local source inspection found no CIMD resolver and no authorize/token `resource` binding. The old plugin stores generated access/refresh values directly; its defaults advertise OIDC scopes, and PKCE is configurable rather than our required S256-only policy. We cannot claim it supplies the audience-bound, digest-only, strict-refresh-family design below. Adding those behaviors and per-blog consent around the old plugin would leave us maintaining a provider fork in practice. These observations concern the installed distribution, not the current docs or an exercised OAuth flow.

### Current Better Auth provider: a different adoption project

Current [OAuth provider docs](https://better-auth.com/docs/plugins/oauth-provider) import `oauthProvider` from **`@better-auth/oauth-provider`**; current [MCP docs](https://better-auth.com/docs/plugins/mcp) use **`@better-auth/mcp`**, **`@better-auth/cimd`**, the JWT plugin and official MCP SDK v2. Do not mount both `mcp()` and `oauthProvider()`; MCP composes the provider.

The npm latest manifests read today are **1.7.12** for [oauth-provider](https://registry.npmjs.org/@better-auth/oauth-provider/latest), [mcp](https://registry.npmjs.org/@better-auth/mcp/latest) and [cimd](https://registry.npmjs.org/@better-auth/cimd/latest). They require `better-auth`/`@better-auth/core` `^1.7.12`; the provider also requires `better-call` 1.4.4 and peer dependencies recorded in that manifest. A provider-based alternative would pin the auth family and these packages to a mutually compatible 1.7.12 set, resolve the documented SDK v2 integration, and retain the lockfile. These are observed current versions, not dependencies installed by this design. Recheck versions and pnpm's **24-hour minimum release age** when implementation begins; never bypass that policy.

Advantages: maintained protocol handling, PKCE, resource binding, DCR, RFC 9207, strict refresh rotation (`refreshTokenReuseInterval: 0`) and CIMD support. Current schema includes `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`; JWT adds persisted signing-key material. Additional resource/link models depend on configuration. Generate the exact schema for the pinned version and translate it into repository-owned SQLite/D1 Drizzle migrations, including auth adapter schema mappings; don't run a generic migrate command against hosted D1. ([Provider](https://better-auth.com/docs/plugins/oauth-provider), [MCP](https://better-auth.com/docs/plugins/mcp), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle))

Costs here: an auth upgrade, SDK integration, persisted signing keys and a per-blog grant extension are still necessary. JWT validation alone does not give immediate disconnect; the API must consult live grant status on every call. Most importantly, current CIMD requires an injected transport which resolves once, rejects special-use addresses, pins the approved peer while preserving TLS identity, and refuses redirects. The bundled transport is Node-only; the docs explicitly say DNS-check-then-Workers-fetch is not equivalent. A trusted URL policy alone does not satisfy that package's transport contract. An approved network service/transport would need to be supplied, not faked. ([CIMD security boundary](https://better-auth.com/docs/plugins/cimd), [Provider revocation](https://better-auth.com/docs/plugins/oauth-provider))

**Any Better Auth upgrade requires re-auditing installed core and emailOTP email-sending routes against [`apps/api/src/server/auth-guards.ts`](../apps/api/src/server/auth-guards.ts), as [`AGENTS.md`](../AGENTS.md) requires.** Do not re-enable unbudgeted email routes while adopting OAuth. The alternative is viable, but not a drop-in plugin switch on 1.6.26.

### Recommended: bounded custom server, existing login

Use Web Crypto randomness/digests, Hono form parsing and existing Drizzle/D1 repository patterns; no Node-only server, new external identity provider, signing-key infrastructure or auth dependency upgrade. All issued tokens are opaque and stored as digests. Our live lookup supplies expiry, audience, scopes, blog and revocation together. Rotation/code redemption must be atomic, not a read followed by an unconditional write.

We own discovery, registration validation, authorize/consent, code exchange, rotation/replay handling, revocation and ongoing protocol updates. Keep this surface deliberately small: only public clients (`none`), two grants (`authorization_code`, `refresh_token`), and one resource (`/mcp`). No generic third-party provider features. This maintenance burden and independent security review are real costs, not reasons to omit protections.
For CIMD, accept only exact operator-configured official Claude and ChatGPT metadata URLs, never arbitrary user URLs or redirects; verify fetched `client_id` exactly, bounded JSON and supported methods, and bind callbacks to the validated document. Display the identity host, not an unverified `client_name`. Cache validated metadata briefly with bounded size and deadlines; fail closed on invalid metadata. This is intentionally restricted interoperability, not a general CIMD resolver. Confirm the current hosted Claude metadata URL through the actual connection request before adding it to configuration; Claude Code's documented URL is above. A new trusted URL is a reviewed configuration change. Use DCR for other clients; do not fetch their logos or remote metadata. This recommendation does not attempt to satisfy the separate Better Auth CIMD package's stronger transport contract with ordinary fetch. ([Claude CIMD rules](https://claude.com/docs/connectors/building/lazy-authentication.md), [ChatGPT CIMD rules](https://developers.openai.com/plugins/build/auth))



## Authorization and permission mapping

A grant belongs to one human, one existing workspace, one blog and one client. A second blog requires another consent/grant. The server rechecks that the human can manage connections for that blog at consent, exchange, refresh and use; account deletion, lost access, or blog deletion disables the grant. Client-provided workspace/blog IDs are never authority.

Consent uses the existing three levels and shared scope definitions, not new OAuth-specific permission names. The chosen level expands to exactly its existing scopes; do not add `posts:publish` to Write drafts. Treat the client's requested scopes as an upper bound, not authority. If a level needs scopes outside the request, explain and restart authorization with the appropriate requested scope set rather than silently widening. If the client asks for a broad supported set, the human may grant a narrower level; return the actual granted scope string in the token response. Unknown scopes produce `invalid_scope`. `offline_access` grants refresh capability only; it is not a content permission and is not passed as a domain scope.

Built differently (2026-10-28): the discovery challenge and a missing `scope` request the Manage scope set as the upper bound, and consent preselects Write and publish; the human must explicitly choose Manage. Reason: claude.ai and Claude mobile connectors can't send a key header, and insufficient scope returns an HTTP 200 tool error (no OAuth step-up), so a narrower ceiling would make publishing, imports with redirects and newsletter setup impossible through sign-in. Permission errors must not auto-promote a connection. No account-wide wildcard and no grant mutation from a token request. Keep scripts/CLI keys unchanged; initial OAuth tokens are audience-bound to MCP, not automatically valid at REST endpoints.

Connections share the existing agent quotas, burst limits and write classification with keys: no extra allowance by creating more OAuth grants. Keep workspace aggregate counters and use grant identity where a key-specific bucket currently applies. Mutations carry the client display name (for example **Claude**) and stable connection ID in activity, alongside the existing actor identity; historical entries retain attribution after disconnect. Never trust a name alone as proof that a client is Claude. Connect shows client identity host/provenance alongside the friendly label for unverified DCR names.

## Proposed data and migration

Names only for future migrations; **create none in this docs change**:

- `0043_agent_oauth.sql` — new OAuth records and activity connection attribution. Never edit 0042 or older migrations. If another change consumes 0043 before implementation, allocate the next free number then.

Tables/fields to design in `packages/db/src/schema.ts` and implement through `packages/db/src` repository operations:

| Record | Required meaning |
|---|---|
| `oauth_clients` | Stable client ID; registration provenance (DCR/trusted CIMD); validated redirect list, metadata identity, display name, public auth method, allowed grants, created/disabled times. DCR names are unverified. |
| `oauth_authorization_requests` | Short-lived server-owned pending transaction: client, exact redirect, requested scopes, resource, S256 challenge, opaque client state, expiry, bound login session/user, one-time CSRF nonce. No arbitrary browser-supplied continuation URL. |
| `oauth_grants` | Human/workspace/blog/client IDs, selected level and immutable granted scope snapshot, resource, created/last-used/revoked times; one consent is one connection. |
| `oauth_authorization_codes` | Unique code digest, request/grant binding, exact client/redirect/resource/challenge, expiry and consumed time. Raw code returned only to the validated callback. |
| `oauth_access_tokens` | Unique digest, grant ID, audience, granted scopes, issued/expiry/revoked times; no plaintext token persistence. |
| `oauth_refresh_tokens` | Unique digest, grant/client/audience/scopes, family ID, generation, replacement link, expiry/consumed/revoked times. Retain spent-token digests to detect replay until family expiry. |
| Activity attribution | Nullable connection ID on activity and a retained display-name snapshot; keys retain existing attribution. |

Add appropriate unique indexes/foreign keys and expiry indexes. Atomic guarded D1 statements/batches must ensure only one exchange wins under concurrency and all revocations are visible to subsequent authentication. A losing refresh cannot mint a second child. No cross-request in-memory state or permissive caches of grant status. Expired transaction/token cleanup is bounded and does not erase replay evidence prematurely.

### Lifetimes (product decisions, not vendor requirements)

- Pending authorization transaction: 10 minutes; authorization code: **60 seconds**, single-use.
- Access token: **15 minutes**, with `expires_in`, `token_type: Bearer`, actual `scope`, and `Cache-Control: no-store`/`Pragma: no-cache` on credential responses.
- Refresh family: **30 days absolute** from consent. Each successful refresh rotates; replacement cannot extend the family's deadline. No reuse grace. A spent refresh replay returns `invalid_grant` and revokes the family and its access tokens. User reconnects after expiry or replay detection.
- Disconnect marks the grant revoked atomically; access and refresh checks consult that grant every time. No “wait 15 minutes” revocation gap. A request already authorized before disconnect can finish; every subsequent authorization check fails.

## Endpoints and discovery

Proposed issuer: `https://app.vibecms.dev` (no trailing slash). Derive environment URLs from trusted configured `APP_URL`, never request Host/forwarded headers. Dev issuer/resource use `https://app.basedui.dev` and cannot accept production tokens or codes.

| Method/path | Responsibility |
|---|---|
| GET `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` | Identical public RFC 9728 metadata. |
| GET `/.well-known/oauth-authorization-server` | Public RFC 8414 metadata. |
| POST `/oauth/register` | JSON RFC 7591 public-client registration, bounded body/redirect counts and independent IP/client abuse limits; no human session required, no privileges from registration. |
| GET `/oauth/authorize` | Validate client/redirect/resource/scopes/S256 before login; create pending transaction and route to existing login then consent. |
| POST `/oauth/consent` | Session + CSRF protected approval/denial of a server-owned pending transaction; choose blog/level, issue code only after approval. |
| POST `/oauth/token` | Form-urlencoded code exchange or refresh; validate client, PKCE, redirect/resource/grant, atomic consumption; standard OAuth errors. |
| POST `/oauth/revoke` | RFC 7009-style public-client token revocation, bound client; do not disclose whether an unknown token exists. |
| Dashboard connection list/disconnect routes | Cookie-session guarded, blog ownership checked, mutation CSRF protected; revoke entire grant, not just one token. |

Protected resource metadata contains `resource: "https://app.vibecms.dev/mcp"`, `authorization_servers: ["https://app.vibecms.dev"]`, `bearer_methods_supported: ["header"]`, and the shared supported domain scopes. AS metadata contains issuer, the three OAuth endpoint URLs plus revocation, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`, supported domain scopes plus `offline_access`. Publish no OIDC discovery or unsupported grants/methods. ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207))

### Request and consent protections

- Reject malformed/unregistered callbacks **locally**, before login or redirecting any error. Validated hosted redirects require exact HTTPS URI equality, no wildcards, fragments or embedded credentials. Do not confuse DCR accepting a declaration with a trusted app endorsement. DCR clients receive public IDs, not a secret that would pretend a desktop client is confidential.
- Allow HTTP only for explicitly registered loopback callbacks. Ignore port only for loopback matching; preserve scheme, exact host, path and query. `localhost.evil.example`, alternate IP encodings and arbitrary subdomains are not loopback. Claude's localhost/127.0.0.1 exception and Cursor's two declared callbacks are above. ([Claude](https://claude.com/docs/connectors/building/authentication.md), [Cursor](https://cursor.com/docs/mcp), [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252))
- Bind consent nonce and pending request to the current Better Auth user/session. Use same-origin Origin/Referer policy and a one-use CSRF token on approval, denial and dashboard disconnect; GET never grants. Never accept scope/blog/client/redirect changes from hidden form fields without checking the stored transaction. Show an explicit consent screen on every new grant; no silent approval based only on a familiar app name.
- Preserve client `state` unchanged through a validated callback, include `iss`, and keep login continuation server-side. Client state is not our consent CSRF defense. Denial returns `access_denied` only to a validated callback.
- Require `resource` to equal our environment's MCP URL at authorization and exchange; bind it into token records and reject a different/missing audience on use. Refresh cannot change client, audience, blog or widen scope. Require S256, never `plain`; verify the code's client, exact redirect and verifier before atomically consuming it. ([MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [ChatGPT](https://developers.openai.com/plugins/build/auth))
- Never log codes, tokens, verifiers, cookies or whole OAuth URLs. Do not load client-supplied logos on consent. Protect consent from framing; use existing app security policy and no-store for personal/credential responses. Limit registration, metadata fetches, login initiation and exchanges independently from authenticated content quotas; OAuth must not bypass the existing OTP budget guard.

## API/MCP integration boundary

Add dedicated OAuth route handlers under `apps/api/src/routes` and mount discovery/OAuth before the generic protected API paths. Keep existing Better Auth human sign-in mounted as-is. Add a dashboard consent route and Connect connections listing/revoke UI in the eventual implementation, using app tokens, never tenant `--vc-*` styles.

At the MCP HTTP authentication boundary, recognize existing `vc_live_` keys and a separately prefixed opaque OAuth access credential; verify either into the same internal agent principal. OAuth lookup must also verify live grant, client, ownership, scope snapshot, resource and expiry. Preserve key hashing/revocation behavior. Today missing/invalid MCP credentials return 401 without `WWW-Authenticate`; add the discovery challenge to both missing and invalid/expired OAuth credential paths before invoking MCP transport. Keep valid-but-insufficient permissions as 403, not 401. REST keeps existing key support; do not accidentally enable OAuth access tokens for the entire REST API just because auth helpers are shared.

Reuse scope checking, operation write classification, usage enforcement and actor plumbing in REST/MCP/core. Extend the Connect route's session authorization for listing and disconnecting grants rather than making OAuth clients able to manage dashboard credentials. No change to the published REST contract is needed unless those dashboard routes are deliberately made public API operations; if they are, update the contract and run `pnpm openapi:check`.

## Rollout and founder acceptance

1. Approve this design and security review criteria; implement behind an environment switch. Keys remain usable throughout. Add the new D1 migration only during implementation, with normal backup/release procedures; this plan applies no database writes.
2. Deploy **dev first** at `app.basedui.dev`. Check both metadata documents and a headerless MCP 401. Add with **no header**:
   ```sh
   claude mcp add --transport http vibecms https://app.basedui.dev/mcp
   ```
   Complete browser sign-in/consent in Claude Code, then connect the same URL through claude.ai's custom connector dialog and call real tools on a populated dev QA blog. Exercise both localhost/127.0.0.1 callbacks and changing ephemeral ports. Include token expiry/refresh and Disconnect, not only initial connection.
3. Exercise current ChatGPT builder and Cursor desktop/web with dev accounts. Resolve `[CHECK]` items before advertising either client; capture exact callbacks/metadata URLs without capturing secrets. Confirm the three levels, tenant isolation, quotas and activity labels. Test network latency well below Claude's limits through the deployed Worker/WAF, not only unit handlers.
4. Implementation gates once after integration: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm openapi:check` if the API contract changed, `pnpm -r --no-bail test`, `pnpm public:audit`; manual deployed consent/Connect checks desktop/mobile and existing key regressions. No code gates are claimed for this docs-only proposal.
5. Promote to production using the normal reviewed deployment path. Change issuer/resource/metadata URLs together; dev grants never migrate to prod. Run a non-destructive production smoke with a dedicated account, then enable the Connect OAuth instructions. Rollback disables new OAuth flows and token acceptance without deleting keys or changing published posts; disconnect/revoke remains available.
6. **Then** submit the remote production server at [claude.ai/directory/manage](https://claude.ai/directory/manage), choosing universal URL and CIMD with DCR fallback. Supply documentation/privacy/support/icon, a fully populated reviewer account with usable email-code access instructions, accurate use cases and annotations (`title` and applicable `readOnlyHint`/`destructiveHint` on every tool). Exercise each tool in Claude before confirming the portal's Test & launch step. A plugin listing is not a connector submission, and directory listing is not required for custom connectors to authenticate. ([Submission requirements](https://claude.com/docs/connectors/building/submission.md))

### Proposed observable tests (approval list, not new test files)

- **Given** a Write drafts connection, **when** it creates/edits a draft then attempts to publish, **then** draft work succeeds, publish is forbidden and no public version changes.
- **Given** a grant for blog A and a known blog B ID, **when** it reads or mutates B, **then** access is denied and B is unchanged.
- **Given** live access and refresh tokens, **when** the owner disconnects, **then** the next MCP call fails with HTTP 401 plus discovery challenge and refresh returns `invalid_grant`.
- **Given** a registered client, **when** authorize supplies an unregistered redirect (including a prefix match or changed query), **then** no consent/code is issued and no redirect to that URI occurs.
- **Given** an authorization code, **when** exchange uses the wrong/missing verifier, wrong client/redirect/resource or a second exchange, **then** it returns no credential; only one correct matching exchange succeeds, including concurrent attempts.
- **Given** a refresh token, **when** it is successfully rotated, **then** the old token fails with `invalid_grant`, a new token works before replay, and replay revokes its family so replacement refresh and related access also fail. Concurrent refresh cannot create two usable children.
- **Given** no bearer credential or an expired one, **when** MCP is called, **then** HTTP status is 401 and `WWW-Authenticate` points to metadata whose resource is exactly that environment's `/mcp`; no wrapped HTTP 200 auth error appears.
- **Given** Claude Code's registered localhost/127.0.0.1 callbacks, **when** ports change, **then** consent succeeds; changed hosts/paths and lookalike hosts fail. Cursor's documented hosted/desktop callbacks both complete.
- **Given** a pending consent page, **when** another session submits its nonce, an attacker submits cross-origin, or the user changes blog/level outside the stored request, **then** no grant is created. Cancel creates none.
- **Given** a trusted CIMD client, **when** metadata is malformed, redirects elsewhere, changes client ID or advertises incompatible methods, **then** authorization fails closed; an arbitrary metadata URL is not fetched.
- **Given** keys and OAuth connections in one workspace, **when** they share content/write usage, **then** existing aggregate rate/plan limits still apply, and activity identifies the correct connection/client or key. A new connection does not reset limits.
- **Given** an owner loses blog access or a blog is deleted, **when** the connection calls or refreshes, **then** it fails; unrelated keys/grants remain unaffected.
- **Given** a dev token/code, **when** used at production or REST, **then** it is rejected. Existing valid REST/MCP keys continue to work with their original scopes and revoke behavior.
- **Given** an initial/refresh token request encoded as form-urlencoded and DCR encoded as JSON, **when** sent through the live edge, **then** each is parsed correctly and responds below Claude's 10/30-second limits with standard OAuth errors for invalid input.

## Founder questions (three)

1. **Default access level?** Recommend **Write drafts**, with explicit consent for publishing or Manage. Existing scripts/CLI keys keep their current defaults; this is not a backwards-incompatible key change. **Built (2026-10-28):** apps are asked for up to Manage and the consent screen preselects Write and publish (the human may pick Write drafts, or explicitly Manage); see the note under permission mapping.
2. **One blog per connection?** Recommend **yes**. It matches today's site-bound keys and makes consent understandable. A second blog is a second connection, not an invisible account-wide expansion.
3. **Scope of the first launch?** Recommend **Claude Code + claude.ai first**, but implement DCR and the documented ChatGPT issuer/callback behavior in the same server. Advertise ChatGPT/Cursor only after their deployed acceptance checks pass; directory submission follows the production smoke. No OIDC/enterprise SSO in this approval.

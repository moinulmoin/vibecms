# AutoSEOPilot managed integration

Status: canonical V1 contract.

Implementation status (2026-09-03): the binding, internal routes, entitlement
gates, credential lifecycle, by-slug read, redaction, and focused worker tests
are implemented and pass locally. The final launch gate remains a credentialed
cross-system production proof of provision, status, REST/MCP use, generation
rotation, revoke, denied credential reuse, and preserved customer content.

## Product boundary

VibeCMS hosting is a built-in managed destination included with an active
AutoSEOPilot Standard workspace. It is not a customer-provided VibeCMS
connection and it is not a separate VibeCMS billing relationship.

The stable cross-system identity is the AutoSEOPilot workspace UUID,
represented as `externalWorkspaceId`. One AutoSEOPilot workspace/site MUST map
to exactly one VibeCMS managed workspace and site. An owner email is used to
find or create the VibeCMS login user and to support same-email OTP access
later. Email MUST NOT be used as the integration key. One email MAY own
multiple managed sites.

The customer supplies no VibeCMS URL, token, account, or setup step. Customer
copy uses Hosted blog, Create hosted blog, and Manage blog. It MUST NOT ask the
customer to Connect VibeCMS or enter token and URL fields.

V1 creates a new managed VibeCMS workspace/site even when the owner already
has a VibeCMS account or site. Existing-account adoption, site import,
content import, and conversion to a separate VibeCMS plan are out of scope.

The implementation reuses existing VibeCMS users, workspaces, sites,
memberships, default domains, posts, versions, activity, media, public URL
helpers, REST API, and scoped API keys. It does not add OAuth, webhooks, a
general partner platform, a second queue, or a generic multi-provider
framework.

## Managed binding and sponsorship

VibeCMS SHOULD add one focused `autoseopilot_managed_sites` D1 table. A
suggested logical shape is:

| Field | Requirement |
| --- | --- |
| `id` | VibeCMS binding ID, primary key |
| `external_workspace_id` | AutoSEOPilot workspace UUID |
| `owner_user_id` | VibeCMS user used for same-email OTP |
| `workspace_id` | VibeCMS workspace ID |
| `site_id` | VibeCMS site ID |
| `credential_id` | AutoSEOPilot-owned stable credential identity |
| `credential_generation` | Positive, monotonic generation |
| `api_key_id` | Current VibeCMS scoped key ID |
| `entitlement_status` | `active` or `revoked` |
| `entitlement_expires_at` | Optional UTC expiry |
| `lifecycle_revision` | Monotonic receipt revision |
| `created_at`, `updated_at`, `revoked_at` | Audit timestamps |

The table MUST have a unique constraint on `external_workspace_id`. It SHOULD
also enforce uniqueness for the managed `workspace_id`, `site_id`, and current
`(credential_id, credential_generation)` identity. Foreign keys MUST bind the
owner, workspace, and site rows. This is an AutoSEOPilot-specific table, not a
generic partner abstraction.

The raw token is never stored in this table or any VibeCMS table. The
existing API-key row stores the existing token hash, prefix, scopes, and
revocation timestamp. The managed binding stores the caller's credential
identity and the Vibe key receipt.

D1 constraints enforce the cross-system key and prevent duplicate managed
sites. Repository code MUST enforce the remaining same-workspace and
same-site invariants in the write unit. A retry after a process crash MUST
look up the unique binding first, then compare immutable identity and
credential generation before creating anything. The request correlation ID
is for tracing only and MUST NOT be the idempotency key.

### Effective hosted entitlement

VibeCMS MUST expose one effective entitlement helper and route every paid
gate through it:

```text
hasEffectiveHostedEntitlement(site, now) =
  site is self-hosted
  OR site has an active Polar subscription
  OR managed sponsorship status is active
     AND (sponsorship expiry is absent OR expiry is in the future)
```

The sponsorship remains separate from Polar billing. The helper MUST be the
source for:

- the published-content cap and publishing writes;
- media upload and related media gates;
- indexing, sitemap, robots, and llms output;
- API usage plan and quota;
- analytics;
- custom domains when they are included by Standard;
- every other existing `requireBillableSite` or equivalent paid gate.

When a managed sponsorship is revoked, or its expiry passes, the helper
becomes false on the next request unless self-hosted or Polar billing supplies
an independent entitlement. New paid writes MUST fail before mutation with the
existing billing error shape and code `BILLING_REQUIRED`. The managed API key
is also revoked by the revoke endpoint, so subsequent calls with that key
fail authentication. Existing posts, versions, media, activity, workspace,
site, default domain, and public URL MUST remain intact. Public output follows
the existing unpaid-site behavior, including noindex and disabled paid feeds
where those gates apply. VibeCMS MUST NOT delete or purge remote content.

## Claim window (keep your blog)

A revoked managed sponsorship starts a 30-day claim window. Day 0 is the
revoke that landed in VibeCMS (`revoked_at`) — VibeCMS owns the clock, and
AutoSEOPilot's own state does not move it. The window exists so a customer
whose plan ends keeps their blog (and its readers) instead of losing it the
same minute.

### Timeline

| Day | What the world sees | What VibeCMS sends |
|---|---|---|
| 0-7 | The blog is fully online on every address (default host, custom domain, subpath), indexed as normal. | AutoSEOPilot sends the day-0 email. |
| 7 | The blog is paused on every address: a neutral "This blog is paused" page, `noindex`, never a bare 404. | First reminder (23 days left). |
| 14 | Still paused. | Reminder (16 days left). |
| 21 | Still paused. | Reminder (9 days left). |
| 28 | Still paused. | Final reminder (2 days left). |
| 30 | The blog is deleted, unless claimed. | Nothing. |

### Serving

The claim window is separate from paid effectiveness. The entitlement helper
returns `servingAllowed` (paid-effective, self-hosted, or inside the grace)
and `servingPaused` (revoked, past the grace, no other source). The public
worker resolves a paused site so it can render the paused page, but never its
content: default host, custom domains, the subpath mount, feeds, sitemap,
`llms.txt`, OG cards, previews and the analytics beacon all answer the paused
page with `X-Robots-Tag: noindex, nofollow` and `cache-control: no-store`.

### Claiming

Claiming is signing in with the same email and buying VibeCMS Cloud. The
sponsor's own day-0 email points the customer at that flow. Nothing moves:
the same blog, posts, media and domain serve again, and a blog that was
claimed is never deleted by this flow again, even if Cloud is cancelled later.
The dashboard shows a "Keep your blog" banner with the exact deadline, and
the billing page states the grace, the pause, the deadline and the upgrade.
The billing payload carries the serving state (`serving`) separately from
the claim window: a blog that was claimed and later lost its subscription is
never deleted and is never shown a deadline, but once no source covers it
the original revoke clock pauses it, and the banner and billing page say so.
Claiming is strictly same-email; there is no transfer to another email at
launch. The owner keeps dashboard access and can read and export during the
window.

A revoked managed workspace can therefore start a checkout: buying VibeCMS
Cloud there is exactly how the customer keeps the blog. A workspace with a
LIVE sponsorship is not for sale (the plan already includes the blog), and a
blog whose purge is under way must not take money at all. The checkout
attempt is written BEFORE the checkout is handed out and carries a 48-hour
purge guard, so a paid claim can never race the deletion of the blog it
pays for.

### Reminders and deletion

One job (`apps/api/src/server/managed-claim-sweep.ts`) owns the window. It
runs on the existing 15-minute cron (`*/15 * * * *`, next to media
recovery), so a reminder lands within 15 minutes of its day and a purge
within 15 minutes of day 30. It selects revoked managed sites whose workspace never claimed VibeCMS Cloud
(no billing row, or status `none`) and, for each one, sends the reminder of
the day it is on — days 7, 14, 21 and 28 — each guarded by its own durable
marker column, so a reminder goes out at most once per claim window even
across replays. All reminders stop as soon as the blog is claimed or the
AutoSEOPilot plan resumes (a resumed plan clears `revoked_at`). A revoke after
a resumed plan opens a new window: the same guarded write that records the
new `revoked_at` clears the four markers, and a marker is only claimed for
the window (`revoked_at` and lifecycle revision) the sweep read, so a sweep
that read an older window can never mark a slot of the newer one.

At day 30 an unclaimed blog is deleted: the Cloudflare custom hostname, the
site's R2 objects (its media prefix and its OG cards), and the D1 rows
(binding, site, workspace, and the user row only when that user owns or
belongs to no other workspace). A claimed workspace is skipped forever.

Deleting a blog is irreversible, so it happens in three steps:

1. A durable **purge intent** (`autoseopilot_purge_intents`, migration 0039)
   is written in ONE atomic statement. It only lands while the binding is
   still revoked, still past its own deadline (`revoked_at + 30 days <= now`,
   never a deadline carried over from an earlier candidate), still the same
   lifecycle the candidate was selected at, its workspace still never claimed
   VibeCMS Cloud, and no claim checkout for that workspace was opened in the
   last 48 hours. The 48 hours are counted from the moment the checkout was
   opened and cover the checkout whether it is still open or already
   resolved: Polar's checkout expiry and a delayed webhook can land anywhere
   in that window, and a customer charged for a blog that was deleted is far
   worse than a purge that runs two days late. The intent records the
   resources the purge will delete: the site's Cloudflare custom hostname ids
   and its R2 prefixes.
2. The external cleanup runs from the recorded resources.
3. The D1 rows go, guarded again inside one transaction that requires the
   intent.

While an intent exists the blog cannot come back. The exclusion lives in the
SQL of the competing writes themselves, not in a separate precheck: the
rotation/reactivation batch, the first provision and the claim-checkout
attempt each carry "no active purge intent" in their own condition, and the
change count turns a blocked write into a retryable refusal. So a decision
and a write can never race. The claim checkout is refused before any money
is taken, a Polar webhook for a blog that is being purged, or that is
already gone, is answered (so Polar stops retrying) and recorded in
`autoseopilot_purge_conflicts` (migration 0040) with the Polar customer,
order and subscription ids, instead of flipping the workspace to paid. That
record is written in the SAME transaction as the webhook receipt, so a
payment can never be lost; if it cannot be written, the receipt is rolled
back with it and Polar retries. Every late event is recorded, but only one
that proves a successful payment (a subscription Polar reports as `active`,
or a succeeded checkout; `payment_evidence`, migration 0041) asks for a
refund: an unpaid, incomplete, past-due or cancelled event is kept as a
record and never mailed, on the normal path and on the deleted-workspace
fallback alike. For a paid one the operator is alerted with the same ids so
the money can be refunded by hand, and the notice goes to the support
address (`SUPPORT_EMAIL`) through the same `send_email` binding the reminder
mail uses, because a log line only reaches someone who goes looking. The
notice is only marked as sent when the mail was accepted (`notified_at`), and
the sweep sends every notice that is still owed. The AutoSEOPilot plan
resumption is refused with a retryable failure, and a re-provision cannot
recreate the same site id and R2 namespace while the purge is under way. A
crashed run leaves the intent behind and the next run resumes the same
cleanup from it; the intent never expires and is never auto-cleared. A
finished intent stays behind as the trace of a deleted blog (`completed_at`),
so a late paid webhook is recognised instead of turning a deleted blog into a
paid workspace with no notice.

The sweep only visits the blogs that have something due: a reminder
that was never sent, or the purge. A blog that was already reminded about
and is not due for the purge yet takes no slot, so a long queue of old blogs
can never starve a newer one. Every attempt is recorded
(`last_sweep_attempt_at`), and the due blogs are ordered by that attempt
first: a blog the sweep cannot delete yet rotates to the back of the queue,
so it can never take the slot of a blog that is still waiting for its
reminder.

One run is bounded by a D1 query budget: D1 allows 1,000 queries per Worker
invocation (Workers Paid, a `batch()` counts as one), and the sweep shares
its invocation with media recovery (at most about 150 queries). The sweep
counts every D1 query it makes and stops at 500 (`SWEEP_QUERY_BUDGET`):
refund notices take at most 51 (one list, 50 marks), resuming crashed purges
at most 200 (3 per intent: the guarded delete batch, a site read, the intent
write), and the rest goes to the due blogs (3 per reminder: attempt marker,
reminder marker, its release on a failed send; 6 per purge: attempt marker,
the intent write and read, then the resume). A unit of work only starts when
the budget still covers its worst case; the blogs that do not fit keep their
place at the front of the queue for the next run, 15 minutes later.

The claim checkout is refused before Polar is asked to sell anything, and
the refusal lives in the write itself: the attempt is only written while
the blog is still there, still revoked and without a live subscription. A
purge that completes between the read and the write therefore cannot let
Polar sell a deleted blog, while a re-provisioned blog can be claimed again
and an owner who claimed the blog and later cancelled (or went unpaid) may
subscribe again.

## Internal API

All managed routes are under `/internal/autoseopilot`:

```text
PUT  /internal/autoseopilot/sites/{externalWorkspaceId}
GET  /internal/autoseopilot/sites/{externalWorkspaceId}
POST /internal/autoseopilot/sites/{externalWorkspaceId}/revoke
```

The route uses the `X-AUTOSEOPILOT-INTERNAL-SECRET` header and the
`AUTOSEOPILOT_INTERNAL_SECRET` VibeCMS environment variable. The value MUST
be compared in constant time. If the environment variable is unset, these
routes MUST behave as not found with HTTP 404. When configured, a missing or
incorrect secret returns HTTP 401 without disclosing managed-site state.
Requests use JSON, a strict schema, and a 64 KiB body limit. Unknown fields,
invalid UUIDs, invalid email addresses, invalid slugs, invalid credential
identity, and invalid entitlement values return validation errors.

The optional `X-Correlation-Id` header is echoed in the response and audit
event, or a server-generated ID is returned. It is limited to 128 characters.
The internal routes MUST NOT depend on browser cookies, VibeCMS sessions, or
browser CSRF state. TLS and normal secret-storage controls are required.
Request bodies, query strings, and logs MUST redact `credential.rawToken` and
the internal secret.

The raw token format remains compatible with existing VibeCMS keys:
`vc_live_` in production and `vc_test_` in non-production, followed by
32 to 128 URL-safe characters. VibeCMS hashes the token using the existing
API-key path and never returns it. AutoSEOPilot MUST use the existing `full`
token preset:

```text
sites:read
posts:read
posts:create
posts:update
posts:publish
posts:archive
assets:write
assets:delete
activity:read
```

### PUT provision or reconcile

Request body:

```json
{
  "ownerEmail": "owner@example.test",
  "siteName": "Example journal",
  "siteSlug": "example-journal",
  "credential": {
    "rawToken": "<production-token>",
    "credentialId": "cred-example-uuid",
    "generation": 1
  },
  "entitlement": {
    "status": "active",
    "expiresAt": null
  }
}
```

`siteSlug` is optional. If omitted for a new site, VibeCMS chooses its normal
available slug. After creation, the site slug is immutable for this contract;
an attempted conflicting change returns `SLUG_CONFLICT`. `siteName` is an
initial default only. After creation, PUT MUST NOT overwrite a name, slug,
theme, domain, or other setting changed by the customer in VibeCMS.

`entitlement.status` is `active` or `revoked`. A new binding MUST use
`active`. A `revoked` PUT is only a reconciliation of an already existing
revoked binding; it MUST NOT create a site, create a key, or reactivate a
binding. Cancellation uses the revoke endpoint below.

On the first accepted PUT, VibeCMS MUST:

1. normalize the owner email for lookup and find or create the VibeCMS user;
   a newly inserted user starts unverified and becomes verified only through
   the normal email-OTP flow;
2. create the VibeCMS workspace, owner membership, site, and default domain
   through existing onboarding primitives;
3. hash and persist the supplied token as one scoped API key;
4. create the managed binding and active sponsorship;
5. write a managed activity event without secret material; and
6. return the receipt below.

These writes MUST commit in one D1 transaction or batch. The implementation
MUST NOT expose a site or credential without the matching unique binding.

The response is the same shape for a first provision, an idempotent retry,
and a reconciliation:

```json
{
  "externalWorkspaceId": "00000000-0000-4000-8000-000000000001",
  "workspaceId": "vc-workspace-example",
  "siteId": "vc-site-example",
  "siteName": "Example journal",
  "apiKeyId": "vc-key-example",
  "apiKeyPrefix": "vc_live_EXAMPLE",
  "publicUrl": "https://example.vibecms.example",
  "entitlement": {
    "status": "active",
    "expiresAt": null,
    "effective": true
  },
  "lifecycle": {
    "revision": 1,
    "status": "active",
    "revokedAt": null
  },
  "correlationId": "corr-example"
}
```

The response MUST NOT contain the raw token, token hash, owner email, or
secret. A successful active provision MUST return a non-null `publicUrl`.
Failure to resolve the default public URL fails the provision rather than
returning an unusable active receipt.

PUT idempotency and generation rules are:

- The same `externalWorkspaceId`, `credentialId`, `generation`, and token
  hash MUST return the existing receipt without a duplicate site, binding, or
  API key. An exact replay does not increment `lifecycle.revision`.
- A different owner email for an existing binding returns HTTP 409 with
  `OWNER_CONFLICT`. Email is not a lookup key after the binding exists.
- The same credential identity with a different raw token returns HTTP 409
  with `CREDENTIAL_CONFLICT`.
- A lower generation, or any active PUT using the current generation after a
  revoke, returns HTTP 409 with `STALE_GENERATION`. A stale active request
  MUST NOT reactivate a revoked binding.
- An active rotation MUST use the same `credentialId` and exactly the next
  generation. VibeCMS soft-revokes the prior key, creates the new hashed key,
  updates the binding, and increments the lifecycle revision. A reactivation
  after revoke also requires a new generation and active entitlement.
- A replay of an already accepted older generation MAY return its historical
  receipt only when VibeCMS persists that receipt. Otherwise it returns
  `STALE_GENERATION`. It MUST never modify current state.
- A generation gap returns HTTP 409 with `GENERATION_GAP`.
- A site-slug collision with another site returns HTTP 409 with
  `SLUG_CONFLICT`.

### GET status

`GET /internal/autoseopilot/sites/{externalWorkspaceId}` uses the same
secret and returns the current receipt shape without changing state. The
receipt re-reads the current VibeCMS-owned `siteName` and `publicUrl`, so a
caller refresh observes customer changes without overwriting them. It is the
recovery read after a timeout or lost response. An unknown external workspace
returns HTTP 404 with `NOT_FOUND`. An expired active sponsorship returns
`status: "active"` and `effective: false`; expiry does not silently create a
new key or change the stored lifecycle status.

### POST revoke

Request body:

```json
{
  "credentialId": "cred-example-uuid",
  "generation": 1,
  "reason": "entitlement_lost"
}
```

`reason` is optional, bounded, and must not contain secrets. The endpoint
accepts the current credential identity, marks the sponsorship and lifecycle
as revoked, and soft-revokes the current VibeCMS API key. It returns the
receipt shape with:

```json
{
  "entitlement": {
    "status": "revoked",
    "expiresAt": null,
    "effective": false
  },
  "lifecycle": {
    "revision": 2,
    "status": "revoked",
    "revokedAt": "2026-10-20T09:00:00.000Z"
  }
}
```

`lifecycle.revokedAt` is the moment VibeCMS recorded the revoke (ISO 8601),
or null while the site is active. The claim window's clock belongs to
VibeCMS, so AutoSEOPilot records this timestamp and shows its deadlines
from it, never from the moment it heard about the revoke.

The complete response still includes `externalWorkspaceId`, `workspaceId`,
`siteId`, `siteName`, `apiKeyId`, `apiKeyPrefix`, `publicUrl`, and
`correlationId`.
`effective` is normally false for a managed-only site. It MAY remain true if
self-hosting or an independent Polar subscription supplies entitlement, but
the AutoSEOPilot API key is still revoked.
Revoke is idempotent: repeating it with the current identity returns the
revoked receipt and does not increment the revision again. A stale generation
or credential ID returns HTTP 409 with `STALE_GENERATION` or
`CREDENTIAL_CONFLICT` and MUST NOT revoke a newer key. Revoke never deletes
posts, versions, media, activity, users, workspaces, sites, domains, or
public content on the spot; an unclaimed blog is deleted later, at the end of
the claim window (see "Claim window (keep your blog)").

### PUT location

`PUT /internal/autoseopilot/sites/{externalWorkspaceId}/location` sets where
the managed blog is served. Body is a discriminated union:

```json
{ "type": "subpath", "url": "https://customer.com/blog" }
{ "type": "default" }
```

`subpath` validates the URL (`validateSubpathLocation`: https host, 1–3 path
segments, never a platform or app host), creates or replaces the site's
`subpath` domain row, and returns `{ location }` — the same view the
dashboard location API returns, including `proxyTarget` and ready-to-paste
`snippets` (Cloudflare Worker, Vercel, Next.js, Netlify, nginx, Caddy) for
the customer's proxy. The Next.js snippet never embeds the proxy link: it
reads it from the `VIBECMS_PROXY_TARGET` environment variable, so the
caller's setup screen must show the proxy target and tell the user to set
that variable in their host (see `packages/core/src/subpath.ts` and
`apps/dashboard/src/components/dashboard/SubpathLocationSection.tsx`). A
`409 BILLING_REQUIRED` means the effective entitlement is off. `default`
removes the subpath mount; the site then serves its remaining active custom
domain while effective entitlement is active, otherwise its
`slug.<zone>` host.

### POST location check

`POST /internal/autoseopilot/sites/{externalWorkspaceId}/location/check`
runs the same "Check setup" probe the dashboard uses: it fetches
`https://<hostname><basePath>/_vc/health`, compares `siteId` and the
SHA-256 fingerprint of the proxy id, and warns on CDN caching or a missing
`Sitemap:` line in the customer root `robots.txt`. Returns
`{ check, location }`. A pass flips the row to `active`; a failed check on a
never-verified row records `failed`; an already-active row stays `active`
(a flaky probe never demotes it — the daily cron re-checks and records the
result the same way). Without a subpath row it returns 404 `NOT_FOUND`.

### Error envelope and status semantics

Every handled error uses:

```json
{
  "error": {
    "code": "SLUG_CONFLICT",
    "message": "The requested site slug is already in use.",
    "correlationId": "corr-example"
  }
}
```

The stable codes are:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Strict schema or value failure |
| 401 | `UNAUTHORIZED` | Missing or invalid internal secret, or invalid bearer token |
| 402 | `BILLING_REQUIRED` | No effective hosted entitlement for a paid operation |
| 403 | `FORBIDDEN` | Bearer token lacks the required scope |
| 404 | `NOT_FOUND` | Unknown binding, site, post, or hidden route |
| 409 | `OWNER_CONFLICT`, `CREDENTIAL_CONFLICT`, `STALE_GENERATION`, `GENERATION_GAP`, `SLUG_CONFLICT`, or `CONFLICT` | Safe retry cannot be accepted |
| 413 | `REQUEST_TOO_LARGE` | Body exceeds 64 KiB |
| 429 | `RATE_LIMIT` | Existing API budget or rate limit |
| 500 | `INTERNAL_ERROR` | Unexpected failure, with no secret details |

The route returns 201 only for a newly created managed binding and 200 for
an idempotent replay, reconcile, rotation, or revoke. GET returns 200 for a
known binding and 404 for an unknown one. A failed transaction MUST NOT return
a fabricated active receipt.

## REST by-slug lookup

Add:

```text
GET /api/v1/posts/by-slug/{slug}
```

The route uses the existing bearer authentication and is site-scoped to the
token. It requires `posts:read`, performs an exact slug match, and returns the
same full post DTO as the existing post read route. A missing post returns
`404 NOT_FOUND`. It MUST NOT use a substring or LIKE search. A published post
includes its public URL through the existing mapper; a draft does not expose a
public URL.

## Ownership, activity, and secret handling

The first accepted owner email resolves to one VibeCMS user and owner
membership. A later managed binding for the same email creates a separate
workspace and site while reusing that user. A different email cannot take
over an existing `externalWorkspaceId`; this is a 409 conflict.

VibeCMS MUST record activity events for provision, reconcile, credential
rotation, and entitlement revoke. Events identify the managed external
workspace, lifecycle revision, credential generation, and result. They MUST
not contain the raw token, token hash, internal secret, or full request body.
Conflict responses are reported through bounded operational logs with the
correlation ID; they do not require customer-site activity rows.

AutoSEOPilot owns token generation. It MUST generate and encrypt the token
before any network I/O. VibeCMS receives it only over the authenticated
internal request, hashes it immediately through the existing API-key path,
and never returns or logs it. The token remains usable only until the Vibe
key is revoked or replaced.

## Implementation slices and focused tests

1. Add the focused binding migration, repository methods, D1 constraints,
   entitlement helper, and activity mapping.
2. Add internal secret middleware, strict schemas, body limits, correlation
   IDs, PUT/GET/revoke handlers, and OpenAPI or route contract coverage.
3. Reuse onboarding and API-key primitives for provision, reconciliation,
   rotation, and revoke.
4. Replace every paid-gate check with the effective entitlement helper.
5. Add the exact by-slug REST route and contract tests.
6. Run a credentialed proof against one workspace-bound managed site before
   any public launch claim.

Focused tests MUST cover:

- first provision, same-email multiple sites, owner conflict, slug conflict,
  and exact response redaction;
- retry after a lost response and simulated crash before and after binding
  creation, with no duplicate site or key;
- same credential identity replay, different-token conflict, generation
  rotation, generation gaps, and stale active requests after revoke;
- idempotent revoke and stale revoke protection;
- route 404 behavior when the secret is unset, constant-time secret
  comparison behavior, strict unknown-field rejection, body limit, and
  correlation propagation;
- every paid gate with active, expired, revoked, self-hosted, and Polar
  entitlements;
- exact by-slug reads, site isolation, missing-slug 404, and `posts:read`
  scope enforcement; and
- denied writes after key revoke while existing content, media, versions,
  activity, and public URL behavior remain preserved.

## Non-goals

V1 does not implement existing VibeCMS account or site adoption, content
import, separate VibeCMS billing conversion, direct-plan handoff, migration
or transfer, remote content purge, ASP account deletion initiated by VibeCMS,
OAuth, browser-session authentication for internal calls, outbound webhooks,
a general partner API, or a second queue.

## Production acceptance checklist

The implementation and automated tests cover these invariants. Check them off
only after rerunning the complete lifecycle with production credentials across
both deployed systems; local green tests alone are not a launch claim.

- [ ] One unique binding exists for `externalWorkspaceId`.
- [ ] Workspace UUID, not email, is the cross-system key.
- [ ] Same-email OTP can manage each separately created managed site.
- [ ] PUT is safe after timeout and does not duplicate sites or keys.
- [ ] Credential identity and generation rules prevent stale reactivation.
- [ ] Raw tokens are generated by AutoSEOPilot, hashed by VibeCMS, and never
  returned or logged.
- [ ] The same effective entitlement helper controls every listed paid gate.
- [ ] Revoke is idempotent, revokes the credential, and preserves all content.
- [ ] Internal routes are hidden when the secret is unset and do not depend
  on browser CSRF or sessions.
- [ ] Exact `GET /api/v1/posts/by-slug/{slug}` exists with `posts:read`.
- [ ] Crash, lost-response, stale-generation, revoke, gate, and by-slug tests
  pass.

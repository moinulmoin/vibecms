# AutoSEOPilot managed integration

Status: canonical V1 contract. This document supersedes
`docs/asp-integration-spec.md`.

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
    "status": "active"
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
secret and returns the current receipt shape without changing state. It is
the recovery read after a timeout or lost response. An unknown external
workspace returns HTTP 404 with `NOT_FOUND`. An expired active sponsorship
returns `status: "active"` and `effective: false`; expiry does not silently
create a new key or change the stored lifecycle status.

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
    "status": "revoked"
  }
}
```

The complete response still includes `externalWorkspaceId`, `workspaceId`,
`siteId`, `apiKeyId`, `apiKeyPrefix`, `publicUrl`, and `correlationId`.
`effective` is normally false for a managed-only site. It MAY remain true if
self-hosting or an independent Polar subscription supplies entitlement, but
the AutoSEOPilot API key is still revoked.
Revoke is idempotent: repeating it with the current identity returns the
revoked receipt and does not increment the revision again. A stale generation
or credential ID returns HTTP 409 with `STALE_GENERATION` or
`CREDENTIAL_CONFLICT` and MUST NOT revoke a newer key. Revoke never deletes
posts, versions, media, activity, users, workspaces, sites, domains, or
public content.

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

## Acceptance checklist

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

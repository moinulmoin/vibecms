# Hosted workspace and account deletion

Operator-only manual runbook for hosted vibecms. This is not a self-service endpoint, a script to paste into production, or permission to delete data. All examples use bound placeholders, never real customer data. Do not disable foreign keys, edit migrations, delete a whole shared bucket/database/dataset, or run a broad email/hostname substring deletion.

## 1. Authorize, inventory, and stop writers

1. Verify the requester's identity and authority over every workspace requested. Record the approved workspace IDs, site IDs, user IDs, scope (workspace only versus login/account too), request time, and operator in the restricted deletion ticket. Obtain any requested export before deletion; do not place content, tokens, subscriber emails, or database exports in the ticket/repository.
2. Select the actual hosted environment in Cloudflare and Polar. Match the API Worker's `DB` and `ASSETS_BUCKET` bindings to the intended database and bucket, including the public and OG Workers sharing them. Use the deployed configuration, not a guessed resource name. Record resource identifiers without secrets.
3. Inventory **all** sites in each workspace and **all** memberships and managed ownership references for each user. A login may belong to several workspaces. Workspace deletion removes every member's membership in that workspace, not every member's login. Preserve unrelated workspaces and users. For an account-wide request, transfer ownership of retained workspaces with explicit approval or include them in the authorized deletion; never strand another customer's workspace.
4. Capture the exact asset and pending-operation keys, site prefixes, domains/Cloudflare IDs, proxy locations, Polar customer/subscription IDs, and row counts below before their parent rows disappear. Keep the manifest restricted and short-lived. Do not export token hashes, session tokens, OAuth tokens, verification values, or subscriber lists merely to count them.
5. Arrange a controlled maintenance window that prevents writes to the selected resources and drains in-flight requests/jobs: dashboard, REST, MCP, login/OTP for an account deletion, subscriber ingress, checkout creation, managed provision/resume/rotation, scheduled publishing, media recovery, analytics rollups, public analytics emission, and OG generation. Coordinate partner-side writers as well. There is no general workspace deletion lock in the schema: revoking API keys, archiving a site, changing billing status, or deleting sessions alone is **not** a complete write barrier. If targeted isolation cannot be guaranteed, use an approved broader maintenance window; do not race live writers.

## 2. Cancel money first; retain invoices

Before removing `billing_customers` or its workspace, open Polar using the captured customer/subscription IDs. Polar keeps one customer per email for the whole organization, so that customer may also pay for the person's other blogs and for other products: a subscription belongs to this workspace only when its metadata `workspaceId` is this workspace. Cancel **every** such subscription and any pending checkout through Polar's supported controls, and nothing else on the customer. A cancellation scheduled for period end still has a future effective date: record it and settle the intended timing before claiming billing has stopped. Check outstanding payments, refunds and disputes, including unresolved `polar_duplicate_subscriptions` rows; resolve them with the billing owner. Deleting a D1 billing row does not cancel a Polar subscription or refund a payment.

Retain invoices, orders and legally required financial records in Polar/the approved restricted accounting system according to the actual retention policy. Do not delete invoices to satisfy content deletion; do not promise erasure of records subject to legal retention. Record only minimal references and the retention basis in the ticket. Do not copy an entire customer profile into a new permanent deletion log.

Drain/reconcile delayed Polar webhooks before the destructive D1 stage. [`billing.ts`](../apps/api/src/server/billing.ts) maps events to a workspace and applies them atomically; its deleted-workspace conflict handling depends on an existing managed purge intent. Ordinary manually deleted workspaces do not automatically acquire that protection. Do not fabricate a managed intent for a normal paid workspace. Have the billing operator resolve subsequent retries/late paid events and refunds; do not globally disable webhook processing for other customers.

## 3. Prefer the managed purge only when eligible

Use the existing managed claim sweep for an **unclaimed, revoked managed blog past its own 30-day claim deadline**. The supported runtime is `runManagedClaimSweep` in [`managed-claim-sweep.ts`](../apps/api/src/server/managed-claim-sweep.ts), on the existing 15-minute cron. It is not an arbitrary account-delete HTTP endpoint. Coordinate the existing runtime/cron rather than invoking an invented CLI command or exposing an admin endpoint.

The repository's `acquirePurgeIntent` checks the matching lifecycle/revoke, elapsed deadline, never-claimed billing state and checkout guard. It durably records Cloudflare IDs and R2 prefixes before external deletion and blocks claim/resume/re-provision while cleanup is active. The sweep resumes unfinished intents, empties `${siteId}/` and `og/${siteId}/`, deletes hostnames best-effort, and calls `purgeRevokedManagedSite` in a transactional D1 batch. That batch removes the managed binding, site, then the workspace only if no sites/bindings remain, then the owner login only if no memberships remain. Site/workspace/auth child rows cascade as described below.

**Do not** backdate `revoked_at`, change billing to `none`, expire a checkout guard, manufacture a purge intent, or bypass the guard to make a paid/claimed/young blog eligible. Use the explicit manual procedure below for authorized deletion outside this lifecycle. A `canceled` billing row is still not `none` and does not satisfy the managed purge guard.

After a managed purge, still do the external verification and residual-table cleanup below. A completed intent is intentionally retained; it is not proof that Cloudflare confirmed deletion or that every unlinked D1 row disappeared. Preserve `autoseopilot_purge_intents` and `autoseopilot_purge_conflicts` as minimal financial/race-safety records under restricted retention; resolve paid conflicts/refunds before closure. Deleting them casually removes late-payment protection. Claim checkout rows have no FK and may survive until their guard expires and the sweep prunes them.

## 4. Remove external resources before losing their identifiers

1. **Cloudflare for SaaS:** for each captured `domains.cloudflare_custom_hostname_id`, delete that exact resource in the correct zone through the Cloudflare dashboard/API (`DELETE /zones/{zone_id}/custom_hostnames/{id}`). Independently confirm it is absent in Cloudflare. [`custom-hostnames.ts`](../apps/api/src/server/custom-hostnames.ts) is deliberately fail-open: missing configuration is a no-op, and `deleteCustomHostname` does not check HTTP success. A successful sweep log or null helper lookup is not evidence of provider deletion. Retry/escalate provider errors without declaring completion.
2. **DNS and subpath proxies:** ask the domain owner to remove/repoint only their obsolete CNAME/validation records and customer-side `/blog` (or captured `base_path`) proxy route/Worker configuration. Delete only records they authorize; never the platform wildcard, fallback origin, zone, or unrelated records. SaaS hostname deletion does not edit customer DNS. A `subpath` domain is not a SaaS hostname merely because it has a hostname: account for its `proxy_id` and customer proxy separately. Preserve routing inventory for post-deletion checks, then discard it on schedule.
3. **R2:** using the correct shared `ASSETS_BUCKET`, list and delete all objects under the exact `${siteId}/` and `og/${siteId}/` prefixes for every selected site, paging/repeating until empty. Include orphaned uploads/OG objects, not just `assets` rows. Also reconcile exact captured `assets.r2_key` and `pending_media_operations.storage_key` values; if a key is outside those prefixes, establish its exclusive ownership before deleting that exact key. Do not infer ownership from a filename substring. Do this while uploads/recovery/OG writers are stopped and before deleting their D1 manifests. Normal media deletion in [`media.ts`](../apps/api/src/server/media.ts) uses durable operations, but D1 cascades do not execute R2 deletes.
4. **Caches and third parties:** purge applicable public/media/OG CDN caches for the selected URLs using supported provider controls; remove customer proxy caches where authorized. Do not flush other tenants unnecessarily. Subscriber ingestion in [`subscribe.ts`](../apps/api/src/server/subscribe.ts) currently stores a pending D1 subscriber and sends no email/provider sync. Nevertheless inventory any actual external newsletter exports/integrations and delete the authorized copies there; a nullable `provider_id` is not proof that no external copy exists. Include email delivery records and operational logs in the retention review, not in a claim of immediate universal erasure.

## 5. D1 deletion order and exact row coverage

Use an approved D1 operator interface and **bound parameters** from the signed-off manifest. The list below is the mutation specification, not an executable mass-delete script. Recheck ownership immediately before execution. Use one supported transactional D1 batch for related database changes; fail closed on unexpected counts or restrictive references. Do not turn foreign keys off. Provider operations cannot be part of that transaction: retain the manifest and resume incomplete work safely.

For the manual path, after billing cancellation, external cleanup and writer isolation: remove only selected `autoseopilot_managed_sites` bindings (if any), delete selected `sites`, then the selected `workspaces` after confirming no retained sites/bindings remain. This deliberately uses the existing cascade relationships rather than implementing a second content purge. Remove residual non-FK rows using reviewed exact selectors. Finally, for an explicitly approved account deletion only, remove selected memberships after transfer/deletion decisions, verify no retained managed ownership, delete `session` and `account` by `user_id`, and delete `user` by ID. Auth children also cascade on user deletion; explicit session revocation at the start does not replace the final pass.

Authoritative ownership: [`schema.ts`](../packages/db/src/schema.ts), plus migrations linked for tables absent from its exports. Confirm the deployed schema with the read-only query in section 6; stop if it differs.

| D1 table | Exact scope and result |
| --- | --- |
| `posts` | `site_id` in the approved site manifest; cascade from site removes drafts, archived and published rows. |
| `post_versions` | `site_id` / `post_id`; immutable versions cascade from site/post, including previously published content. |
| `post_preview_tokens` | `site_id` / `post_id`; cascade, invalidating stored preview tokens. |
| `post_schedules` | `site_id` / `post_id`; cascade; drain processing leases first. |
| `post_slug_redirects` | `site_id` / `post_id`; cascade, including old slug mappings. |
| `site_redirects` | `site_id`; cascade removes imported old-link mappings. |
| `post_seo_reviews` | `site_id` / `post_id`; cascade; cached review content. See [0035](../packages/db/drizzle/0035_post_seo_reviews.sql). |
| `site_voice_profiles` | `site_id`; cascade, including writing guidance/samples represented there. |
| `site_theme_previous_look` | `site_id`; cascade; see [0032](../packages/db/drizzle/0032_site_theme_previous_look.sql). |
| `assets` | `site_id`; cascade removes metadata only; delete R2 first. |
| `pending_media_operations` | `site_id`; cascade; preserve storage keys and stop reconciler before deleting. |
| `subscribers` | `site_id`; cascade removes all statuses, consent provenance and hashes. |
| `activity_events` | `site_id`; cascade removes summaries, before/after payloads and actor metadata. |
| `analytics_rollups` | `site_id`; cascade removes every granularity/kind/dimension. |
| `analytics_rollup_state` | `site_id`; cascade; prevent rollup recreation. |
| `api_keys` | `site_id`; revoke selected keys during isolation, cascade deletes all selected-site keys, including revoked/old generations. Never expose token hashes. |
| `oauth_authorizations` | `api_key_id` cascades with a site's connection; `user_id` cascades for account deletion, including pending consent. |
| `oauth_tokens` | `api_key_id` cascades with the connection; never expose token hashes. |
| `oauth_clients` | Shared client registrations are not user or site records; retain them when deleting a customer. Deleting a client cascades its connections, so do not delete one as customer cleanup. |
| `domains` | `site_id`; cascade removes default/custom/subpath claims, not Cloudflare resources or DNS. |
| `usage_counters` | `site_id` rows cascade from site; **also** delete via workspace cascade for `workspace_id`, including rows with null `site_id`. |
| `sites` | Exact IDs and matching `workspace_id`; delete only approved sites. |
| `memberships` | `workspace_id` cascades with workspace. `user_id` has **no user FK**; explicitly remove approved account's residual memberships only after retained-workspace decisions. |
| `billing_customers` | `workspace_id`; workspace cascade removes local Polar linkage/status, not money or invoices. |
| `workspaces` | Exact approved IDs; delete after all selected children/bindings and billing reconciliation. |
| `autoseopilot_managed_sites` | Exact binding/site/workspace IDs; restrict FKs block site/workspace/user/current-key deletion until binding is removed by the guarded purge or approved manual path. Stop partner re-provisioning first. |
| `autoseopilot_claim_checkouts` | Exact `workspace_id`; no FK. Reconcile pending payment and guard first; remove as approved residual cleanup, never to trick the sweep. |
| `polar_webhook_receipts` | Exact `workspace_id`; no FK, survives purge. [0013](../packages/db/drizzle/0013_polar_webhook_receipts.sql). Retain minimal receipts while replay/deduplication/accounting obligations require them; record retention and expiry rather than silently deleting them. |
| `autoseopilot_purge_intents` | Exact `workspace_id` / `site_id` / `owner_user_id`; no FK. Retain the genuine completed intent for late-webhook safety; review retained identifying IDs/prefixes under retention policy. Do not create fake records or delete active intents. |
| `autoseopilot_purge_conflicts` | Exact `workspace_id` / `site_id`; no FK. Retain restricted refund/payment evidence and resolve notification/refund obligations. |
| `polar_duplicate_subscriptions` | Exact `workspace_id`; no FK, survives purge. A second paid subscription that was never applied: retain restricted refund evidence and resolve notification/refund obligations. |
| `session` | Exact `user_id`; delete for account-wide deletion, including all devices/IP/user-agent records; user cascade also covers it. Do not log `token`. |
| `account` | Exact `user_id`; delete all linked provider accounts/tokens for account-wide deletion; user cascade also covers it. Remove vibecms's provider authorization where supported/authorized, not the customer's Google/GitHub account. |
| `user` | Exact ID only, and only approved account-wide scope. Shared login survives workspace-only deletion. Guard against remaining memberships and managed ownership. |
| `verification` | No user FK; does not cascade. For account-wide deletion, select/delete exact reviewed IDs with `identifier = 'sign-in-otp-' || lower(:email)`; never read `value`. Installed Better Auth 1.6.26 `dist/plugins/email-otp/utils.mjs` defines `${type}-otp-${email}`, and `routes.mjs` lowercases email before storing it. Current [auth guards](../apps/api/src/server/auth-guards.ts) allow only sign-in OTP sends. Also inspect exact `email-verification-otp-{lowercase-email}` and `forget-password-otp-{lowercase-email}` identifiers for historical rows; if historical email changes existed, use the approved exact old/new pair to identify `change-email-otp-{old-email}-{new-email}`. Do not use email substring matching or infer an ambiguous pair. Review other historical verification flows by their exact identifiers before claiming complete cleanup. Preserve a shared login's verification rows for workspace-only deletion. Re-audit these version-specific formats on Better Auth upgrades. |
| `rate_limits` | No FK. Exact site prefixes are `subscribe:{siteId}:` and `subscribe-proxied:{siteId}:`; account OTP prefix is `otp-send:{lowercase-email}:` ([auth-rate-limit.ts](../apps/api/src/server/auth-rate-limit.ts), [subscribe.ts](../apps/api/src/server/subscribe.ts)). Delete only matching exact prefix boundaries, or reviewed exact IDs. Keep a shared login's OTP buckets for workspace-only deletion. |

Account deletion can leave author/actor strings in **retained** sites (`created_by_id`, `updated_by_id`, `actor_id`, `actor_name`, schedule attribution, voice-profile attribution, API-key creator IDs). These are not user FKs. Inventory such references before deleting the login; resolve authorized redaction/retention with the privacy owner without deleting other tenants' content. Account deletion is not automatically permission to erase every shared post the user edited.

## 6. Read-only before/after queries

Run these through a parameter-binding D1 interface against the approved database. `:workspace_id`, `:site_id`, `:user_id`, and `:email` mean bound values, not string interpolation. Repeat per manifest entry, retaining the same original IDs **after** parent deletion; a query that derives sites from a now-missing workspace can falsely report zero. Keep output restricted. These statements do not perform deletion.

```sql
-- Actual tables/FKs, including migration-only tables and deployment drift.
SELECT name, sql FROM sqlite_schema
WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
PRAGMA foreign_key_check;

-- Ownership and retained-workspace decisions.
SELECT id, slug FROM workspaces WHERE id = :workspace_id;
SELECT id, workspace_id, slug FROM sites WHERE workspace_id = :workspace_id;
SELECT workspace_id, user_id, role FROM memberships
WHERE workspace_id = :workspace_id OR user_id = :user_id;
SELECT id, workspace_id, site_id, owner_user_id, entitlement_status, revoked_at
FROM autoseopilot_managed_sites
WHERE workspace_id = :workspace_id OR owner_user_id = :user_id;
SELECT workspace_id, polar_customer_id, polar_subscription_id, status,
       cancel_at_period_end, current_period_end
FROM billing_customers WHERE workspace_id = :workspace_id;

-- Exact external manifests; never select secret auth columns.
SELECT id, hostname, type, base_path, proxy_id, cloudflare_custom_hostname_id
FROM domains WHERE site_id = :site_id;
SELECT id, r2_key FROM assets WHERE site_id = :site_id;
SELECT id, kind, storage_key FROM pending_media_operations WHERE site_id = :site_id;

-- Repeat for EVERY original site ID before and after.
SELECT 'posts' AS table_name, count(*) AS rows FROM posts WHERE site_id = :site_id
UNION ALL SELECT 'post_versions', count(*) FROM post_versions WHERE site_id = :site_id
UNION ALL SELECT 'post_preview_tokens', count(*) FROM post_preview_tokens WHERE site_id = :site_id
UNION ALL SELECT 'post_schedules', count(*) FROM post_schedules WHERE site_id = :site_id
UNION ALL SELECT 'post_slug_redirects', count(*) FROM post_slug_redirects WHERE site_id = :site_id
UNION ALL SELECT 'site_redirects', count(*) FROM site_redirects WHERE site_id = :site_id
UNION ALL SELECT 'post_seo_reviews', count(*) FROM post_seo_reviews WHERE site_id = :site_id
UNION ALL SELECT 'site_voice_profiles', count(*) FROM site_voice_profiles WHERE site_id = :site_id
UNION ALL SELECT 'site_theme_previous_look', count(*) FROM site_theme_previous_look WHERE site_id = :site_id
UNION ALL SELECT 'assets', count(*) FROM assets WHERE site_id = :site_id
UNION ALL SELECT 'pending_media_operations', count(*) FROM pending_media_operations WHERE site_id = :site_id
UNION ALL SELECT 'subscribers', count(*) FROM subscribers WHERE site_id = :site_id
UNION ALL SELECT 'activity_events', count(*) FROM activity_events WHERE site_id = :site_id
UNION ALL SELECT 'analytics_rollups', count(*) FROM analytics_rollups WHERE site_id = :site_id
UNION ALL SELECT 'analytics_rollup_state', count(*) FROM analytics_rollup_state WHERE site_id = :site_id
UNION ALL SELECT 'api_keys', count(*) FROM api_keys WHERE site_id = :site_id
UNION ALL SELECT 'oauth_authorizations', count(*) FROM oauth_authorizations WHERE api_key_id IN (SELECT id FROM api_keys WHERE site_id = :site_id)
UNION ALL SELECT 'oauth_tokens', count(*) FROM oauth_tokens WHERE api_key_id IN (SELECT id FROM api_keys WHERE site_id = :site_id)
UNION ALL SELECT 'domains', count(*) FROM domains WHERE site_id = :site_id
UNION ALL SELECT 'usage_counters', count(*) FROM usage_counters WHERE site_id = :site_id
UNION ALL SELECT 'sites', count(*) FROM sites WHERE id = :site_id;

SELECT 'memberships' AS table_name, count(*) AS rows FROM memberships WHERE workspace_id = :workspace_id
UNION ALL SELECT 'billing_customers', count(*) FROM billing_customers WHERE workspace_id = :workspace_id
UNION ALL SELECT 'usage_counters', count(*) FROM usage_counters WHERE workspace_id = :workspace_id
UNION ALL SELECT 'autoseopilot_managed_sites', count(*) FROM autoseopilot_managed_sites WHERE workspace_id = :workspace_id
UNION ALL SELECT 'autoseopilot_claim_checkouts', count(*) FROM autoseopilot_claim_checkouts WHERE workspace_id = :workspace_id
UNION ALL SELECT 'workspaces', count(*) FROM workspaces WHERE id = :workspace_id;

-- Retained ledgers: explain each remaining row, do not demand zero blindly.
SELECT event_id, event_type, applied_status FROM polar_webhook_receipts WHERE workspace_id = :workspace_id;
SELECT id, site_id, completed_at FROM autoseopilot_purge_intents WHERE workspace_id = :workspace_id;
SELECT id, payment_evidence, notified_at FROM autoseopilot_purge_conflicts WHERE workspace_id = :workspace_id;
SELECT id, kept_subscription_id, payment_evidence, notified_at FROM polar_duplicate_subscriptions WHERE workspace_id = :workspace_id;

-- Account scope only; workspace-only deletion must preserve unrelated access.
SELECT 'user' AS table_name, count(*) AS rows FROM user WHERE id = :user_id
UNION ALL SELECT 'session', count(*) FROM session WHERE user_id = :user_id
UNION ALL SELECT 'account', count(*) FROM account WHERE user_id = :user_id
UNION ALL SELECT 'oauth_authorizations', count(*) FROM oauth_authorizations WHERE user_id = :user_id
UNION ALL SELECT 'memberships', count(*) FROM memberships WHERE user_id = :user_id
UNION ALL SELECT 'managed_ownership', count(*) FROM autoseopilot_managed_sites WHERE owner_user_id = :user_id;

-- Exact prefix comparison avoids LIKE wildcard expansion in IDs/email.
SELECT id FROM rate_limits
WHERE substr(id, 1, length('subscribe:' || :site_id || ':')) = 'subscribe:' || :site_id || ':'
   OR substr(id, 1, length('subscribe-proxied:' || :site_id || ':')) = 'subscribe-proxied:' || :site_id || ':';
SELECT id FROM rate_limits
WHERE substr(id, 1, length('otp-send:' || lower(:email) || ':')) = 'otp-send:' || lower(:email) || ':';
-- Account-wide deletion only. Installed Better Auth 1.6.26 exact identifiers:
SELECT id, identifier, expires_at FROM verification
WHERE identifier IN (
  'sign-in-otp-' || lower(:email),
  'email-verification-otp-' || lower(:email),
  'forget-password-otp-' || lower(:email)
);
-- Historical email-change records require an approved exact old/new pair.
-- Other historical verification flows: bind each reviewed exact identifier.
SELECT id, identifier, expires_at FROM verification WHERE identifier = :verification_identifier;
```

Expected after-state: zero selected-site/workspace rows and selected non-FK residuals; account rows zero only when account deletion was approved; every retained ledger/reference has a recorded reason and review/expiry. Recheck `PRAGMA foreign_key_check`. Compare retained workspace/site counts to the before snapshot to detect collateral removal.

## 7. Raw analytics, backups, and closure

D1 rollup deletion does **not** erase raw Cloudflare Analytics Engine points. [`analytics.ts`](../apps/api/src/server/analytics.ts) queries the configured dataset with `index1 = siteId`; its 365-day dashboard retention constant is not proof of the provider's raw retention or a per-site delete API. Determine the actual dataset retention and provider-supported erasure process with Cloudflare. Do not issue unsupported SQL `DELETE` or drop the shared dataset. Record whether selected points were provider-erased or remain access-restricted until a documented expiry. Ensure rollups cannot reimport them while deletion is in progress. Review public emission paths in [public analytics](../apps/public/src/server/public-analytics.ts) and [agent analytics](../apps/public/src/server/public-agent-analytics.ts).

Inventory D1 Time Travel/PITR, manual D1 exports, R2 copies/backups, downloaded exports, support attachments, log sinks and provider records. Primary D1 deletion does not immediately scrub historical snapshots. Record each actual configured retention/expiry, authorized legal hold and access restriction; do not invent a universal backup-retention duration. Remove independently deletable customer exports/copies under policy without deleting other tenants' backups. Avoid creating a new full production backup solely for this request. If a required backup must be taken, encrypt/restrict it and assign an expiry.

Maintain a minimal restricted deletion ledger sufficient to **reapply deletion before reopening traffic after any restore**. A PITR/backup restore must occur in isolation: re-delete the recorded D1 rows, R2 objects and credentials, recheck billing/domain state and external copies, then reopen traffic. Do not restore deleted customer content to a live environment or claim erasure while retained copies are unaccounted for.

Before closure, confirm through read-only evidence: empty exact R2 prefixes/keys; absent SaaS resources; removed/repointed customer routing or a documented customer action still outstanding; zero expected D1 counts; retained data unaffected; canceled Polar renewal state; invoices retained appropriately; no unresolved paid conflicts; backup/raw analytics/log retention documented. With authorization, check former public/default/custom/subpath/preview/media URLs no longer serve the deleted content and old credentials cannot access the deleted resources. Do not sign the deleted login back in to test it: OTP/social sign-in may create a new account. Deletion is not an account re-registration ban.

State completion accurately: primary hosted data deletion, billing cancellation, and separately any lawful retained financial records or delayed backup/provider expiry. If Cloudflare deletion, writer isolation, provider retention, or ownership cannot be established, keep the ticket open with that exact blocker rather than claiming complete erasure.

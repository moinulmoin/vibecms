/**
 * Sites + billing repository persistence contracts under real miniflare D1.
 *
 * Phase 2 of the Drizzle migration introduced two new repositories in @vc/db
 * (sites, billing) and routed the app layer (onboarding, billing, Polar
 * webhook) through `createDataAccess(env.DB)`. This suite defends the
 * persistence contracts most at risk in that conversion:
 *
 *   - onboarding atomicity: ensureOnboardingBase inserts workspace + owner
 *     membership + site + active default domain + site.created activity as one
 *     atomic batch, every row landing with the right shape.
 *   - onboarding idempotency: a second call with the same ids creates NO extra
 *     rows (defends INSERT OR IGNORE / onConflictDoNothing on every statement).
 *   - setup/settings atomic writes: completeSiteSetup mutates site fields, the
 *     default-domain hostname, AND writes an activity row together;
 *     updateSiteSettings mutates site fields and writes an activity row.
 *   - billing idempotency: ensureBillingRow is INSERT OR IGNORE per workspace.
 *   - Polar webhook COALESCE: upsertFromWebhook keeps the prior
 *     polar_subscription_id when the incoming one is null while overwriting the
 *     other fields, and overwrites it when a new id is supplied.
 *
 * IDs are file-scoped ("sb-") so this file never collides with the other suites
 * sharing the miniflare D1 instance (isolation: site-a/b/ws-iso; leaf: leaf-*).
 *
 * Run via:
 *   pnpm --filter @vc/db test
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createDataAccess } from "@vc/db";

// Fixed epoch-second anchors. The onboarding/setup repos take an explicit
// timestamp in their input, so these make every persisted created_at/updated_at
// assertion deterministic (and prove the batch wired OUR timestamp through,
// rather than stamping Date.now() internally).
const T = 1_704_000_000;
const T2 = 1_704_010_000;

// Shared data access over the real miniflare D1 binding.
const da = createDataAccess(env.DB);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
});

// ---------------------------------------------------------------------------
// helpers (raw SQL is allowed in tests; the repos are exercised for writes)
// ---------------------------------------------------------------------------

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ c: number }>();
  return row?.c ?? 0;
}

// ---------------------------------------------------------------------------
// sites.ensureOnboardingBase — atomicity
// ---------------------------------------------------------------------------

describe("sites.ensureOnboardingBase — atomic 5-row onboarding insert", () => {
  const input = {
    timestamp: T,
    workspace: { id: "ws-sb-onboard", name: "SB Onboard Workspace", slug: "ws-sb-onboard" },
    membership: { id: "mem-sb-onboard", workspaceId: "ws-sb-onboard", userId: "user-sb-onboard" },
    site: {
      id: "site-sb-onboard",
      workspaceId: "ws-sb-onboard",
      name: "SB Onboard Site",
      slug: "site-sb-onboard",
      description: "Onboarded via ensureOnboardingBase",
    },
    defaultDomain: { id: "dom-sb-onboard", siteId: "site-sb-onboard", hostname: "site-sb-onboard.example.test" },
    siteCreatedActivity: { id: "act-sb-onboard", siteId: "site-sb-onboard", summary: "Site created" },
  };

  it("creates workspace + owner membership + site + active default domain + site.created activity together", async () => {
    await da.sites.ensureOnboardingBase(input);

    // Site row (description + exact timestamp prove the batch used our input).
    const current = await da.sites.getCurrentSite("site-sb-onboard");
    expect(current).not.toBeNull();
    expect(current).toMatchObject({
      id: "site-sb-onboard",
      name: "SB Onboard Site",
      slug: "site-sb-onboard",
      description: "Onboarded via ensureOnboardingBase",
      createdAt: T,
      updatedAt: T,
    });

    // Owner membership.
    expect(await da.sites.getMembershipRole("ws-sb-onboard", "user-sb-onboard")).toBe("owner");

    // Default domain is type=default / status=active with the seeded hostname.
    expect(await da.sites.getActiveDefaultHostname("site-sb-onboard")).toBe("site-sb-onboard.example.test");
    const dom = await env.DB
      .prepare("SELECT type, status, hostname FROM domains WHERE site_id = ?")
      .bind("site-sb-onboard")
      .first<{ type: string; status: string; hostname: string }>();
    expect(dom).toMatchObject({ type: "default", status: "active", hostname: "site-sb-onboard.example.test" });

    // site.created activity row, entity is the site itself.
    const act = await env.DB
      .prepare("SELECT action, entity_type, entity_id, actor_type, summary FROM activity_events WHERE id = ?")
      .bind("act-sb-onboard")
      .first<{ action: string; entity_type: string; entity_id: string; actor_type: string; summary: string }>();
    expect(act).toMatchObject({
      action: "site.created",
      entity_type: "site",
      entity_id: "site-sb-onboard",
      actor_type: "system",
      summary: "Site created",
    });
  });

  it("is idempotent: a second call with the same ids creates no duplicate rows", async () => {
    // Dedicated ids so this test is hermetic — it does NOT depend on the
    // atomicity test above having run first.
    const idem = {
      timestamp: T,
      workspace: { id: "ws-sb-idem", name: "SB Idem Workspace", slug: "ws-sb-idem" },
      membership: { id: "mem-sb-idem", workspaceId: "ws-sb-idem", userId: "user-sb-idem" },
      site: {
        id: "site-sb-idem",
        workspaceId: "ws-sb-idem",
        name: "SB Idem Site",
        slug: "site-sb-idem",
        description: "Idempotency fixture",
      },
      defaultDomain: { id: "dom-sb-idem", siteId: "site-sb-idem", hostname: "site-sb-idem.example.test" },
      siteCreatedActivity: { id: "act-sb-idem", siteId: "site-sb-idem", summary: "Site created" },
    };

    await da.sites.ensureOnboardingBase(idem);
    // Second call with identical ids MUST resolve (no UNIQUE violation) and
    // change nothing — defends the INSERT OR IGNORE / onConflictDoNothing on
    // every statement in the batch.
    await expect(da.sites.ensureOnboardingBase(idem)).resolves.toBeUndefined();

    expect(await countRows("SELECT COUNT(*) AS c FROM workspaces WHERE id = ?", "ws-sb-idem")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS c FROM sites WHERE id = ?", "site-sb-idem")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS c FROM domains WHERE site_id = ?", "site-sb-idem")).toBe(1);
    expect(
      await countRows(
        "SELECT COUNT(*) AS c FROM memberships WHERE workspace_id = ? AND user_id = ?",
        "ws-sb-idem",
        "user-sb-idem",
      ),
    ).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS c FROM activity_events WHERE site_id = ?", "site-sb-idem")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// sites setup + settings atomic writes
// ---------------------------------------------------------------------------

describe("sites setup + settings — atomic field + domain + activity writes", () => {
  it("completeSiteSetup atomically updates site fields, the default-domain hostname, and writes an activity row", async () => {
    // Bootstrap a fresh site (incl. its default domain) via the onboarding batch.
    await da.sites.ensureOnboardingBase({
      timestamp: T,
      workspace: { id: "ws-sb-setup", name: "SB Setup Workspace", slug: "ws-sb-setup" },
      membership: { id: "mem-sb-setup", workspaceId: "ws-sb-setup", userId: "user-sb-setup" },
      site: {
        id: "site-sb-setup",
        workspaceId: "ws-sb-setup",
        name: "SB Setup Site",
        slug: "site-sb-setup",
        description: "Pre-setup",
      },
      defaultDomain: { id: "dom-sb-setup", siteId: "site-sb-setup", hostname: "site-sb-setup.local.test" },
      siteCreatedActivity: { id: "act-sb-setup-created", siteId: "site-sb-setup", summary: "Site created" },
    });

    const hostnameBefore = await da.sites.getActiveDefaultHostname("site-sb-setup");
    expect(hostnameBefore).toBe("site-sb-setup.local.test");

    await da.sites.completeSiteSetup({
      timestamp: T2,
      siteId: "site-sb-setup",
      site: {
        name: "SB Setup Live",
        slug: "site-sb-setup-live",
        description: "Setup completed",
        defaultSeoTitle: "Setup SEO Title",
        defaultSeoDescription: "Setup SEO Description",
      },
      defaultDomainHostname: "site-sb-setup.vibecms.app",
      activity: {
        id: "act-sb-setup-done",
        actorType: "human",
        actorId: "user-sb-setup",
        actorName: "Setup User",
        action: "site.updated",
        summary: "Site setup completed",
      },
    });

    // Site fields changed.
    expect(await da.sites.getSiteSetup("site-sb-setup")).toMatchObject({
      name: "SB Setup Live",
      slug: "site-sb-setup-live",
      description: "Setup completed",
      defaultSeoTitle: "Setup SEO Title",
    });

    // Default-domain hostname changed in the SAME write.
    expect(await da.sites.getActiveDefaultHostname("site-sb-setup")).toBe("site-sb-setup.vibecms.app");

    // The activity row landed (2 rows now: created + updated; the new one is the update).
    expect(await countRows("SELECT COUNT(*) AS c FROM activity_events WHERE site_id = ?", "site-sb-setup")).toBe(2);
    const act = await env.DB
      .prepare("SELECT action FROM activity_events WHERE id = ?")
      .bind("act-sb-setup-done")
      .first<{ action: string }>();
    expect(act?.action).toBe("site.updated");
  });

  it("updateSiteSettings updates site fields (incl. theme/seo/description) and writes an activity row", async () => {
    await da.sites.ensureOnboardingBase({
      timestamp: T,
      workspace: { id: "ws-sb-settings", name: "SB Settings Workspace", slug: "ws-sb-settings" },
      membership: { id: "mem-sb-settings", workspaceId: "ws-sb-settings", userId: "user-sb-settings" },
      site: {
        id: "site-sb-settings",
        workspaceId: "ws-sb-settings",
        name: "SB Settings Site",
        slug: "site-sb-settings",
        description: "Before",
      },
      defaultDomain: { id: "dom-sb-settings", siteId: "site-sb-settings", hostname: "site-sb-settings.local.test" },
      siteCreatedActivity: { id: "act-sb-settings-created", siteId: "site-sb-settings", summary: "Site created" },
    });

    // Onboarding leaves theme at its schema default ('minimal') — sanity, then mutate.
    expect((await da.sites.getSiteSettings("site-sb-settings"))?.theme).toBe("minimal");

    await da.sites.updateSiteSettings({
      timestamp: T2,
      siteId: "site-sb-settings",
      site: {
        name: "SB Settings Renamed",
        description: "Settings description",
        defaultSeoTitle: "Settings SEO Title",
        defaultSeoDescription: "Settings SEO Description",
        theme: "editorial",
        themeAccent: null,
        themeFont: null,
        themeMode: "system",
      },
      activity: {
        id: "act-sb-settings-saved",
        actorType: "human",
        actorId: "user-sb-settings",
        actorName: "Settings User",
        action: "site.settings.updated",
        summary: "Site settings updated",
      },
    });

    expect(await da.sites.getSiteSettings("site-sb-settings")).toMatchObject({
      name: "SB Settings Renamed",
      description: "Settings description",
      defaultSeoTitle: "Settings SEO Title",
      defaultSeoDescription: "Settings SEO Description",
      theme: "editorial",
      slug: "site-sb-settings",
    });

    expect(await countRows("SELECT COUNT(*) AS c FROM activity_events WHERE site_id = ?", "site-sb-settings")).toBe(2);
    const act = await env.DB
      .prepare("SELECT action FROM activity_events WHERE id = ?")
      .bind("act-sb-settings-saved")
      .first<{ action: string }>();
    expect(act?.action).toBe("site.settings.updated");
  });
});

// ---------------------------------------------------------------------------
// sites read getters — seeded values + null for unknown ids
// ---------------------------------------------------------------------------

describe("sites read getters — seeded values and null for unknown ids", () => {
  it("return the seeded values for a known site and null for an unknown id", async () => {
    await da.sites.ensureOnboardingBase({
      timestamp: T,
      workspace: { id: "ws-sb-getters", name: "SB Getters Workspace", slug: "ws-sb-getters" },
      membership: { id: "mem-sb-getters", workspaceId: "ws-sb-getters", userId: "user-sb-getters" },
      site: {
        id: "site-sb-getters",
        workspaceId: "ws-sb-getters",
        name: "SB Getters Site",
        slug: "site-sb-getters",
        description: "Getters fixture",
      },
      defaultDomain: { id: "dom-sb-getters", siteId: "site-sb-getters", hostname: "site-sb-getters.example.test" },
      siteCreatedActivity: { id: "act-sb-getters", siteId: "site-sb-getters", summary: "Site created" },
    });

    expect(await da.sites.getSiteSlug("site-sb-getters")).toBe("site-sb-getters");
    expect(await da.sites.getSiteTheme("site-sb-getters")).toBe("minimal");
    expect(await da.sites.getCurrentSite("site-sb-getters")).toMatchObject({
      id: "site-sb-getters",
      name: "SB Getters Site",
      slug: "site-sb-getters",
      description: "Getters fixture",
    });
    expect(await da.sites.getSiteSetup("site-sb-getters")).toMatchObject({
      name: "SB Getters Site",
      slug: "site-sb-getters",
      description: "Getters fixture",
      defaultSeoTitle: null,
    });
    expect(await da.sites.getSiteSettings("site-sb-getters")).toMatchObject({
      theme: "minimal",
      slug: "site-sb-getters",
      defaultSeoTitle: null,
      defaultSeoDescription: null,
    });
    // Known member is the owner; an unknown user resolves to no membership.
    expect(await da.sites.getMembershipRole("ws-sb-getters", "user-sb-getters")).toBe("owner");
    expect(await da.sites.getMembershipRole("ws-sb-getters", "user-sb-nobody")).toBeNull();

    // Unknown site id -> every getter returns null.
    const ghost = "site-sb-missing";
    expect(await da.sites.getCurrentSite(ghost)).toBeNull();
    expect(await da.sites.getSiteSlug(ghost)).toBeNull();
    expect(await da.sites.getSiteTheme(ghost)).toBeNull();
    expect(await da.sites.getSiteSetup(ghost)).toBeNull();
    expect(await da.sites.getSiteSettings(ghost)).toBeNull();
    expect(await da.sites.getActiveDefaultHostname(ghost)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sites.repairDefaultHostname
// ---------------------------------------------------------------------------

describe("sites.repairDefaultHostname — rewrites the local default hostname", () => {
  it("changes a stale default hostname to the slug-zone hostname and getActiveDefaultHostname reflects it", async () => {
    await da.sites.ensureOnboardingBase({
      timestamp: T,
      workspace: { id: "ws-sb-repair", name: "SB Repair Workspace", slug: "ws-sb-repair" },
      membership: { id: "mem-sb-repair", workspaceId: "ws-sb-repair", userId: "user-sb-repair" },
      site: {
        id: "site-sb-repair",
        workspaceId: "ws-sb-repair",
        name: "SB Repair Site",
        slug: "site-sb-repair",
        description: "Repair fixture",
      },
      defaultDomain: { id: "dom-sb-repair", siteId: "site-sb-repair", hostname: "site-sb-repair.wrong.test" },
      siteCreatedActivity: { id: "act-sb-repair", siteId: "site-sb-repair", summary: "Site created" },
    });

    expect(await da.sites.getActiveDefaultHostname("site-sb-repair")).toBe("site-sb-repair.wrong.test");

    const returned = await da.sites.repairDefaultHostname({
      siteId: "site-sb-repair",
      currentHostname: "site-sb-repair.wrong.test",
      newHostname: "site-sb-repair.vibecms.app",
    });
    expect(returned).toBe("site-sb-repair.vibecms.app");
    expect(await da.sites.getActiveDefaultHostname("site-sb-repair")).toBe("site-sb-repair.vibecms.app");
  });
});

// ---------------------------------------------------------------------------
// billing — idempotency, lookups, webhook upsert, COALESCE guard
// ---------------------------------------------------------------------------

async function seedWorkspace(id: string): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare("INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, id, ts, ts)
    .run();
}

async function seedSite(id: string, workspaceId: string): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, workspaceId, id, id, ts, ts)
    .run();
}

describe("billing — ensureBillingRow idempotency + lookups", () => {
  it("ensureBillingRow inserts a 'none' row and is idempotent (second call is a no-op)", async () => {
    await seedWorkspace("ws-sb-ensure");

    await da.billing.ensureBillingRow("ws-sb-ensure");
    const first = await da.billing.getBillingRecord("ws-sb-ensure");
    expect(first).toMatchObject({ workspaceId: "ws-sb-ensure", status: "none", polarSubscriptionId: null });

    // Second call must NOT throw and must NOT add a second row or change status.
    await expect(da.billing.ensureBillingRow("ws-sb-ensure")).resolves.toBeUndefined();
    expect(await countRows("SELECT COUNT(*) AS c FROM billing_customers WHERE workspace_id = ?", "ws-sb-ensure")).toBe(
      1,
    );
    expect((await da.billing.getBillingRecord("ws-sb-ensure"))?.status).toBe("none");
  });

  it("getWorkspaceIdForSite resolves the owning workspace and getBillingRecord returns the row", async () => {
    await seedWorkspace("ws-sb-site");
    await seedSite("site-sb-site", "ws-sb-site");

    expect(await da.billing.getWorkspaceIdForSite("site-sb-site")).toBe("ws-sb-site");
    expect(await da.billing.getWorkspaceIdForSite("site-sb-nosite")).toBeUndefined();

    // No billing row yet.
    expect(await da.billing.getBillingRecord("ws-sb-site")).toBeUndefined();

    await da.billing.ensureBillingRow("ws-sb-site");
    const row = await da.billing.getBillingRecord("ws-sb-site");
    expect(row).toMatchObject({ workspaceId: "ws-sb-site", status: "none" });
  });
});

describe("billing.upsertFromWebhook — insert path", () => {
  it("inserts a full row for a new workspace (customer/subscription/status/period)", async () => {
    await seedWorkspace("ws-sb-new");

    await da.billing.upsertFromWebhook({
      workspaceId: "ws-sb-new",
      polarCustomerId: "cust_sb_new",
      polarSubscriptionId: "sub_sb_new",
      status: "active",
      currentPeriodEnd: 2_000_000_000,
    });

    const row = await da.billing.getBillingRecord("ws-sb-new");
    expect(row).toMatchObject({
      workspaceId: "ws-sb-new",
      polarCustomerId: "cust_sb_new",
      polarSubscriptionId: "sub_sb_new",
      status: "active",
      currentPeriodEnd: 2_000_000_000,
    });
  });
});

describe("billing.upsertFromWebhook — COALESCE keeps the existing subscription id", () => {
  // This is the load-bearing Polar-webhook contract: a webhook payload that
  // omits the subscription id (null) MUST NOT wipe a previously stored one.
  // A naive `polar_subscription_id = excluded.polar_subscription_id` update
  // would null it out — the assertions below redden under that mutation.
  it("preserves the prior subscription id when incoming is null, then overwrites when a new id is supplied", async () => {
    await seedWorkspace("ws-sb-coalesce");

    // 1. Seed a subscription id.
    await da.billing.upsertFromWebhook({
      workspaceId: "ws-sb-coalesce",
      polarCustomerId: "cust_sb_coal_a",
      polarSubscriptionId: "sub_123",
      status: "none",
      currentPeriodEnd: 1_000_000_000,
    });
    expect((await da.billing.getBillingRecord("ws-sb-coalesce"))?.polarSubscriptionId).toBe("sub_123");

    // 2. Incoming subscription id is null — COALESCE must keep 'sub_123' while
    //    overwriting customer, status, and period.
    await da.billing.upsertFromWebhook({
      workspaceId: "ws-sb-coalesce",
      polarCustomerId: "cust_sb_coal_b",
      polarSubscriptionId: null,
      status: "active",
      currentPeriodEnd: 2_000_000_000,
    });
    expect(await da.billing.getBillingRecord("ws-sb-coalesce")).toMatchObject({
      polarSubscriptionId: "sub_123", // preserved by COALESCE
      polarCustomerId: "cust_sb_coal_b", // overwritten from excluded
      status: "active",
      currentPeriodEnd: 2_000_000_000,
    });

    // 3. A non-null incoming id overwrites the stored one.
    await da.billing.upsertFromWebhook({
      workspaceId: "ws-sb-coalesce",
      polarCustomerId: "cust_sb_coal_c",
      polarSubscriptionId: "sub_456",
      status: "past_due",
      currentPeriodEnd: 3_000_000_000,
    });
    expect(await da.billing.getBillingRecord("ws-sb-coalesce")).toMatchObject({
      polarSubscriptionId: "sub_456", // overwritten
      polarCustomerId: "cust_sb_coal_c",
      status: "past_due",
      currentPeriodEnd: 3_000_000_000,
    });
  });
});

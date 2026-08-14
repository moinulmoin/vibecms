/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import {
  createDataAccess,
  evaluateEffectiveHostedEntitlement,
  normalizeManagedOwnerEmail,
  type ManagedFirstProvisionInput,
} from "@vc/db";

const data = createDataAccess(env.DB);
const NOW = 2_000_000_000;
const FULL_SCOPES = JSON.stringify([
  "sites:read",
  "posts:read",
  "posts:create",
  "posts:update",
  "posts:publish",
  "posts:archive",
  "assets:write",
  "activity:read",
]);

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
});

function provisionInput(
  suffix: string,
  overrides: Partial<ManagedFirstProvisionInput> = {},
): ManagedFirstProvisionInput {
  return {
    timestamp: NOW,
    owner: {
      id: `managed-user-${suffix}`,
      name: `Managed Owner ${suffix}`,
      email: `Owner-${suffix}@Example.TEST`,
    },
    workspace: {
      id: `managed-ws-${suffix}`,
      name: `Managed Workspace ${suffix}`,
      slug: `managed-ws-${suffix}`,
    },
    membership: { id: `managed-membership-${suffix}` },
    site: {
      id: `managed-site-${suffix}`,
      name: `Managed Site ${suffix}`,
      slug: `managed-site-${suffix}`,
      description: null,
    },
    defaultDomain: {
      id: `managed-domain-${suffix}`,
      hostname: `managed-site-${suffix}.example.test`,
    },
    apiKey: {
      id: `managed-key-${suffix}`,
      name: "AutoSEOPilot",
      tokenPrefix: `vc_test_managed_${suffix}`,
      tokenHash: `hash-managed-${suffix}`,
      scopesJson: FULL_SCOPES,
      actorName: "AutoSEOPilot",
    },
    binding: {
      id: `managed-binding-${suffix}`,
      externalWorkspaceId: `external-managed-${suffix}`,
      credentialId: `managed-credential-${suffix}`,
      credentialGeneration: 1,
      entitlementStatus: "active",
      entitlementExpiresAt: null,
      lifecycleRevision: 1,
    },
    ...overrides,
  };
}

describe("evaluateEffectiveHostedEntitlement", () => {
  it("covers self-hosted, Polar, active sponsorship, expiry, exact expiry, and revoke", () => {
    expect(
      evaluateEffectiveHostedEntitlement(
        { selfHosted: true, polar: { status: "none", currentPeriodEnd: null } },
        NOW,
      ),
    ).toMatchObject({
      effective: true,
      access: "self_hosted",
      activeSources: ["self_hosted"],
    });

    expect(
      evaluateEffectiveHostedEntitlement(
        { selfHosted: false, polar: { status: "active", currentPeriodEnd: NOW + 100 } },
        NOW,
      ),
    ).toMatchObject({
      effective: true,
      access: "hosted_paid",
      activeSources: ["polar"],
      effectiveUntil: NOW + 100,
    });

    expect(
      evaluateEffectiveHostedEntitlement(
        {
          selfHosted: false,
          managedSponsorship: { status: "active", expiresAt: NOW + 100 },
        },
        NOW,
      ),
    ).toMatchObject({
      effective: true,
      access: "hosted_paid",
      activeSources: ["managed_sponsorship"],
      effectiveUntil: NOW + 100,
    });

    for (const expiresAt of [NOW, NOW - 1]) {
      expect(
        evaluateEffectiveHostedEntitlement(
          { selfHosted: false, managedSponsorship: { status: "active", expiresAt } },
          NOW,
        ),
      ).toMatchObject({
        effective: false,
        access: "hosted_free",
        activeSources: [],
      });
    }

    expect(
      evaluateEffectiveHostedEntitlement(
        { selfHosted: false, managedSponsorship: { status: "revoked", expiresAt: null } },
        NOW,
      ),
    ).toMatchObject({
        effective: false,
        access: "hosted_free",
      activeSources: [],
    });
  });

  it("keeps independent sources active and chooses self-hosted access first", () => {
    const result = evaluateEffectiveHostedEntitlement(
      {
        selfHosted: true,
        polar: { status: "active", currentPeriodEnd: NOW + 20 },
        managedSponsorship: { status: "active", expiresAt: NOW + 10 },
      },
      NOW,
    );
    expect(result).toMatchObject({
      effective: true,
      access: "self_hosted",
      activeSources: ["self_hosted", "polar", "managed_sponsorship"],
      effectiveUntil: null,
    });
  });
});

describe("managed site database foundation", () => {
  it("normalizes owner email and provisions all rows atomically", async () => {
    const input = {
      ...provisionInput("atomic"),
      activity: {
        requestId: "managed-correlation-provision",
      },
    };
    const snapshot = await data.managedSites.firstProvision(input);

    expect(normalizeManagedOwnerEmail(input.owner.email)).toBe("owner-atomic@example.test");
    expect(snapshot).toMatchObject({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      ownerUserId: input.owner.id,
      ownerEmail: "owner-atomic@example.test",
      workspaceId: input.workspace.id,
      siteId: input.site.id,
      siteSlug: input.site.slug,
      defaultDomainHostname: input.defaultDomain.hostname,
      defaultDomainStatus: "active",
      apiKeyId: input.apiKey.id,
      apiKeyPrefix: input.apiKey.tokenPrefix,
      apiKeyHash: input.apiKey.tokenHash,
      entitlementStatus: "active",
      credentialGeneration: 1,
      lifecycleRevision: 1,
    });
    expect(
      await env.DB.prepare("SELECT email_verified AS verified FROM user WHERE id = ?")
        .bind(input.owner.id)
        .first<{ verified: number }>(),
    ).toMatchObject({ verified: 0 });

    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM activity_events WHERE site_id = ?")
        .bind(input.site.id)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });
    const provisionAudit = await env.DB.prepare(
      "SELECT after_json, request_id FROM activity_events WHERE site_id = ? LIMIT 1",
    ).bind(input.site.id).first<{ after_json: string; request_id: string | null }>();
    expect(provisionAudit?.request_id).toBe("managed-correlation-provision");
    expect(JSON.parse(provisionAudit?.after_json ?? "{}")).toMatchObject({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      lifecycleRevision: 1,
      credentialGeneration: 1,
      result: "provisioned",
      entitlementStatus: "active",
    });
    expect(provisionAudit?.after_json).not.toContain("owner-atomic@example.test");
    expect(provisionAudit?.after_json).not.toContain("hash-managed-atomic");

    // A retry after the response is lost is an exact read, not a second site/key.
    const replay = await data.managedSites.firstProvision(input);
    expect(replay.id).toBe(snapshot.id);
    const replayOutcome = await data.managedSites.firstProvisionWithOutcome(input);
    expect(replayOutcome).toMatchObject({ created: false, snapshot: { id: snapshot.id } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM autoseopilot_managed_sites WHERE external_workspace_id = ?")
        .bind(input.binding.externalWorkspaceId)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });
  });

  it("enforces one canonical user identity regardless of email casing", async () => {
    const input = provisionInput("canonical-email");
    await data.managedSites.firstProvision(input);

    await expect(
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
         VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      ).bind(
        "canonical-email-duplicate",
        "Duplicate owner",
        input.owner.email.toUpperCase(),
        NOW + 1,
        NOW + 1,
      ).run(),
    ).rejects.toThrow();
  });

  it("rejects revoked, mismatched, and slug-conflicting replays", async () => {
    const input = provisionInput("replay-guards");
    await data.managedSites.firstProvision(input);

    await expect(
      data.managedSites.firstProvision({
        ...input,
        site: { ...input.site, slug: "other-slug" },
      }),
    ).rejects.toThrow("managed_site_slug_conflict");

    await data.managedSites.revoke({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      credentialGeneration: 1,
      expectedLifecycleRevision: 1,
      timestamp: NOW + 1,
      activity: { requestId: "replay-revoke" },
    });

    await expect(data.managedSites.firstProvision(input)).rejects.toThrow("managed_replay_revoked");
  });

  it("returns the same receipt for concurrent identical first provisions", async () => {
    const input = provisionInput("concurrent");
    const receipts = await Promise.all([
      data.managedSites.firstProvision(input),
      data.managedSites.firstProvision(input),
    ]);
    expect(receipts[0]?.id).toBe(receipts[1]?.id);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM autoseopilot_managed_sites WHERE external_workspace_id = ?")
        .bind(input.binding.externalWorkspaceId)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM sites WHERE id = ?")
        .bind(input.site.id)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM api_keys WHERE id = ?")
        .bind(input.apiKey.id)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });

    const outcomeInput = provisionInput("concurrent-outcome");
    const outcomes = await Promise.all([
      data.managedSites.firstProvisionWithOutcome(outcomeInput),
      data.managedSites.firstProvisionWithOutcome(outcomeInput),
    ]);
    expect(outcomes.map((result) => result.created).sort()).toEqual([false, true]);
    expect(outcomes[0]?.snapshot.id).toBe(outcomes[1]?.snapshot.id);
  });

  it("reuses one normalized user for separate same-email managed workspaces", async () => {
    const first = provisionInput("same-email-a");
    await data.managedSites.firstProvision(first);

    const second = provisionInput("same-email-b", {
      owner: {
        ...first.owner,
        id: "managed-user-same-email-b",
        email: " owner-same-email-a@example.test ",
      },
    });
    const snapshot = await data.managedSites.firstProvision(second);
    expect(snapshot.ownerUserId).toBe(first.owner.id);
    expect(snapshot.workspaceId).toBe(second.workspace.id);
    expect(snapshot.siteId).toBe(second.site.id);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM user WHERE lower(email) = ?")
        .bind("owner-same-email-a@example.test")
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });
    expect(await data.sites.listAccessibleApps(first.owner.id)).toEqual([
      expect.objectContaining({
        workspaceId: first.workspace.id,
        siteId: first.site.id,
        role: "owner",
        managedStatus: "active",
      }),
      expect.objectContaining({
        workspaceId: second.workspace.id,
        siteId: second.site.id,
        role: "owner",
        managedStatus: "active",
      }),
    ]);
  });

  it("resolves isolated snapshots and effective analytics sites", async () => {
    const first = provisionInput("isolation-a");
    const second = provisionInput("isolation-b");
    await data.managedSites.firstProvision(first);
    await data.managedSites.firstProvision(second);

    await env.DB.prepare(
      "INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
    ).bind("managed-billing-a", first.workspace.id, NOW + 500, NOW, NOW).run();
    await env.DB.prepare(
      "UPDATE autoseopilot_managed_sites SET entitlement_expires_at = ? WHERE external_workspace_id = ?",
    ).bind(NOW - 1, second.binding.externalWorkspaceId).run();

    expect((await data.managedSites.getSnapshotBySiteId(first.site.id))?.siteId).toBe(first.site.id);
    expect(await data.managedSites.getSnapshotByWorkspaceId(second.workspace.id)).toMatchObject({
      workspaceId: second.workspace.id,
      siteId: second.site.id,
    });

    const firstEntitlement = await data.managedSites.resolveSite(first.site.id, {
      selfHosted: false,
      now: NOW,
    });
    expect(firstEntitlement).toMatchObject({ effective: true, access: "hosted_paid" });
    expect(
      await data.managedSites.resolveSite(second.site.id, { selfHosted: false, now: NOW }),
    ).toMatchObject({ effective: false, access: "hosted_free" });

    const entitled = await data.managedSites.listEffectiveEntitledActiveSites({
      selfHosted: false,
      now: NOW,
    });
    expect(entitled.map((site) => site.id)).toContain(first.site.id);
    expect(entitled.map((site) => site.id)).not.toContain(second.site.id);
  });

  it("CAS-protects rotation/reactivation and revoke while preserving site content", async () => {
    const input = provisionInput("lifecycle");
    await data.managedSites.firstProvision(input);

    const gap = await data.managedSites.rotateOrReactivate({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      currentGeneration: 1,
      newGeneration: 3,
      expectedLifecycleRevision: 1,
      newApiKey: {
        id: "managed-key-lifecycle-gap",
        name: "AutoSEOPilot",
        tokenPrefix: "vc_test_managed_lifecycle_gap",
        tokenHash: "hash-managed-lifecycle-gap",
        scopesJson: FULL_SCOPES,
        actorName: "AutoSEOPilot",
      },
      entitlementExpiresAt: NOW + 10,
      timestamp: NOW + 1,
    });
    expect(gap.applied).toBe(false);
    expect(gap.snapshot).toMatchObject({
      credentialGeneration: 1,
      lifecycleRevision: 1,
      apiKeyId: input.apiKey.id,
      apiKeyRevokedAt: null,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM api_keys WHERE id = ?")
        .bind("managed-key-lifecycle-gap")
        .first<{ c: number }>(),
    ).toMatchObject({ c: 0 });

    const rotated = await data.managedSites.rotateOrReactivate({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      currentGeneration: 1,
      newGeneration: 2,
      expectedLifecycleRevision: 1,
      newApiKey: {
        id: "managed-key-lifecycle-2",
        name: "AutoSEOPilot",
        tokenPrefix: "managed-prefix-lifecycle-2",
        tokenHash: "hash-managed-lifecycle-2",
        scopesJson: FULL_SCOPES,
        actorName: "AutoSEOPilot",
      },
      entitlementExpiresAt: NOW + 10,
      timestamp: NOW + 2,
      activity: {
        requestId: "managed-correlation-rotate",
      },
    });
    expect(rotated.applied).toBe(true);
    expect(rotated.snapshot).toMatchObject({
      credentialGeneration: 2,
      lifecycleRevision: 2,
      apiKeyId: "managed-key-lifecycle-2",
      entitlementStatus: "active",
    });
    const rotationAudit = await env.DB.prepare(
      "SELECT after_json, request_id FROM activity_events WHERE id = ?",
    ).bind(`autoseopilot:${input.binding.externalWorkspaceId}:2`)
      .first<{ after_json: string; request_id: string | null }>();
    expect(rotationAudit?.request_id).toBe("managed-correlation-rotate");
    expect(JSON.parse(rotationAudit?.after_json ?? "{}")).toMatchObject({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      lifecycleRevision: 2,
      credentialGeneration: 2,
      result: "rotated",
      entitlementStatus: "active",
    });

    const revoked = await data.managedSites.revoke({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      credentialGeneration: 2,
      expectedLifecycleRevision: 2,
      timestamp: NOW + 3,
      reason: "entitlement_lost",
      activity: {
        requestId: "managed-correlation-revoke",
      },
    });
    expect(revoked.applied).toBe(true);
    expect(revoked.snapshot).toMatchObject({
      entitlementStatus: "revoked",
      entitlementExpiresAt: null,
      lifecycleRevision: 3,
      apiKeyRevokedAt: NOW + 3,
    });
    const audit = await env.DB.prepare(
      "SELECT id, after_json, request_id FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(input.site.id).first<{ id: string; after_json: string; request_id: string | null }>();
    expect(audit?.id).toBe(`autoseopilot:${input.binding.externalWorkspaceId}:3`);
    expect(audit?.request_id).toBe("managed-correlation-revoke");
    expect(JSON.parse(audit?.after_json ?? "{}")).toMatchObject({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      lifecycleRevision: 3,
      credentialGeneration: 2,
      result: "revoked",
      entitlementStatus: "revoked",
    });
    expect(audit?.after_json).not.toContain("owner@example.test");
    expect(audit?.after_json).not.toContain("sensitive-hash");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM sites WHERE id = ?")
        .bind(input.site.id)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 1 });

    const stale = await data.managedSites.rotateOrReactivate({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      currentGeneration: 2,
      newGeneration: 3,
      expectedLifecycleRevision: 2,
      newApiKey: {
        id: "managed-key-lifecycle-stale",
        name: "AutoSEOPilot",
        tokenPrefix: "vc_test_managed_lifecycle_stale",
        tokenHash: "hash-managed-lifecycle-stale",
        scopesJson: FULL_SCOPES,
        actorName: "AutoSEOPilot",
      },
      entitlementExpiresAt: null,
      timestamp: NOW + 4,
    });
    expect(stale.applied).toBe(false);
    expect(stale.snapshot?.apiKeyId).toBe("managed-key-lifecycle-2");
    const staleReconcile = await data.managedSites.reconcile({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      credentialGeneration: 2,
      expectedLifecycleRevision: 2,
      entitlementStatus: "active",
      entitlementExpiresAt: NOW + 100,
      timestamp: NOW + 5,
      activity: { requestId: "managed-correlation-stale-reconcile" },
    });
    expect(staleReconcile.applied).toBe(false);
    const idempotentRevoke = await data.managedSites.revoke({
      externalWorkspaceId: input.binding.externalWorkspaceId,
      credentialId: input.binding.credentialId,
      credentialGeneration: 2,
      expectedLifecycleRevision: 2,
      timestamp: NOW + 6,
      activity: { requestId: "managed-correlation-idempotent-revoke" },
    });
    expect(idempotentRevoke.applied).toBe(false);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS c FROM activity_events WHERE site_id = ?")
        .bind(input.site.id)
        .first<{ c: number }>(),
    ).toMatchObject({ c: 3 });
  });
});

describe("managed binding migration constraints", () => {
  it("rejects non-positive generations/revisions and duplicate managed identities", async () => {
    const fixture = provisionInput("constraints");
    await data.managedSites.firstProvision(fixture);

    await expect(
      env.DB.prepare(
        `INSERT INTO autoseopilot_managed_sites (
           id, external_workspace_id, owner_user_id, workspace_id, site_id, credential_id,
           credential_generation, api_key_id, entitlement_status, lifecycle_revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
        .bind(
          "managed-binding-invalid",
          "external-invalid",
          fixture.owner.id,
          fixture.workspace.id,
          fixture.site.id,
          "managed-credential-invalid",
          0,
          fixture.apiKey.id,
          0,
          NOW,
          NOW,
        )
        .run(),
    ).rejects.toThrow();

    const other = provisionInput("constraints-other");
    await expect(data.managedSites.firstProvision(other)).resolves.toBeDefined();
    await expect(
      env.DB.prepare(
        `INSERT INTO autoseopilot_managed_sites (
           id, external_workspace_id, owner_user_id, workspace_id, site_id, credential_id,
           credential_generation, api_key_id, entitlement_status, lifecycle_revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
        .bind(
          "managed-binding-duplicate",
          fixture.binding.externalWorkspaceId,
          other.owner.id,
          other.workspace.id,
          other.site.id,
          "managed-credential-duplicate",
          1,
          other.apiKey.id,
          1,
          NOW,
          NOW,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("enforces status and revoked_at consistency", async () => {
    const fixture = provisionInput("status-check");
    await data.managedSites.firstProvision(fixture);
    await expect(
      env.DB.prepare(
        "UPDATE autoseopilot_managed_sites SET entitlement_status = 'revoked', revoked_at = NULL WHERE id = ?",
      )
        .bind(fixture.binding.id)
        .run(),
    ).rejects.toThrow();
  });
});

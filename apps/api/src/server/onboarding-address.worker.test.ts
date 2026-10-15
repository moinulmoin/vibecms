/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import type { Actor } from "@vc/core";
import { completeSiteSetupForApp, type AppUserContext } from "@/server/onboarding";
import { defaultHostname } from "@/server/public-url";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const T = 1_704_000_000;
const WORKSPACE_ID = "ws-ob-address";

function ownerApp(siteId: string): AppUserContext {
  const actor: Actor = { type: "human", id: `owner-${siteId}`, name: "Owner", role: "owner" };
  return {
    user: { id: `owner-${siteId}`, name: "Owner", email: `${siteId}@example.com` },
    siteId,
    workspaceId: WORKSPACE_ID,
    actor,
  };
}

async function seedSite(siteId: string, slug: string) {
  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(siteId, WORKSPACE_ID, "My Blog", slug, T, T).run();
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)",
  ).bind(`dom-${siteId}`, siteId, defaultHostname(slug), T, T).run();
}

async function slugOf(siteId: string) {
  return (await env.DB.prepare("SELECT slug FROM sites WHERE id = ?").bind(siteId).first<{ slug: string }>())?.slug;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(WORKSPACE_ID, "Address Workspace", WORKSPACE_ID, T, T).run();
  await seedSite("site-addr-owner", "field-notes");
  await seedSite("site-addr-new", "placeholder-addr-new");
  await seedSite("site-addr-race-a", "placeholder-race-a");
  await seedSite("site-addr-race-b", "placeholder-race-b");
  await seedSite("site-addr-short", "xy");
  await seedSite("site-addr-host", "placeholder-addr-host");
  // A custom domain row already holding the hostname another blog would derive.
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'active', ?, ?)",
  ).bind("dom-host-claim", "site-addr-owner", defaultHostname("hostname-held"), T, T).run();
});

afterEach(() => vi.restoreAllMocks());

describe("completeSiteSetupForApp address handling", () => {
  it("maps an address another blog owns to address_taken and keeps the current slug", async () => {
    await expect(
      completeSiteSetupForApp(ownerApp("site-addr-new"), { name: "Field Notes", slug: "field-notes" }),
    ).resolves.toEqual({ kind: "error", code: "address_taken" });
    expect(await slugOf("site-addr-new")).toBe("placeholder-addr-new");
  });

  it("maps a hostname held by another domain row to address_taken", async () => {
    await expect(
      completeSiteSetupForApp(ownerApp("site-addr-host"), { name: "Held", slug: "hostname-held" }),
    ).resolves.toEqual({ kind: "error", code: "address_taken" });
  });

  it("lets exactly one of two racing claims win; the loser gets address_taken", async () => {
    const results = await Promise.all([
      completeSiteSetupForApp(ownerApp("site-addr-race-a"), { name: "Race", slug: "race-claim" }),
      completeSiteSetupForApp(ownerApp("site-addr-race-b"), { name: "Race", slug: "race-claim" }),
    ]);
    expect(results.map((result) => result.code).sort()).toEqual(["address_taken", "setup_complete"]);
  });

  it("does not disguise unrelated database failures as address_taken", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T * 1000 + 5_000);
    const app = ownerApp("site-addr-owner");
    await expect(completeSiteSetupForApp(app, { name: "Field Notes", slug: "field-notes" }))
      .resolves.toEqual({ kind: "ok", code: "setup_complete" });
    // Same second, same user: the activity id collides, which is not an address problem.
    await expect(completeSiteSetupForApp(app, { name: "Field Notes", slug: "field-notes" })).rejects.toThrow();
  });

  it("rejects reserved, too-short and empty new addresses before writing", async () => {
    const app = ownerApp("site-addr-new");
    await expect(completeSiteSetupForApp(app, { name: "Admin", slug: "admin" }))
      .resolves.toEqual({ kind: "error", code: "slug_reserved" });
    await expect(completeSiteSetupForApp(app, { name: "X", slug: "x-" }))
      .resolves.toEqual({ kind: "error", code: "address_too_short" });
    await expect(completeSiteSetupForApp(app, { name: "!!!???", slug: "" }))
      .resolves.toEqual({ kind: "error", code: "address_required" });
    await expect(completeSiteSetupForApp(app, { name: "Полевые заметки", slug: "" }))
      .resolves.toEqual({ kind: "error", code: "address_required" });
    expect(await slugOf("site-addr-new")).toBe("placeholder-addr-new");
  });

  it("saves the explicit address for a symbol-only name exactly as the preview shows it", async () => {
    await expect(completeSiteSetupForApp(ownerApp("site-addr-new"), { name: "!!!???", slug: "Café Notes" }))
      .resolves.toEqual({ kind: "ok", code: "setup_complete" });
    expect(await slugOf("site-addr-new")).toBe("cafe-notes");
  });

  it("keeps an existing short address working when it is re-saved", async () => {
    await expect(completeSiteSetupForApp(ownerApp("site-addr-short"), { name: "XY", slug: "xy" }))
      .resolves.toEqual({ kind: "ok", code: "setup_complete" });
    expect(await slugOf("site-addr-short")).toBe("xy");
  });
});

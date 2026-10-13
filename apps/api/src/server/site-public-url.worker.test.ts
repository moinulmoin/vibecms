/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { getSiteAssetBaseUrl, getSitePublicBaseUrl } from "@/server/site-public-url";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

// IDs are file-scoped ("spu-*") so this suite never collides with the other
// suites sharing the miniflare D1 instance.
const WORKSPACE_ID = "ws-spu";
const T = 1_700_000_000;
// wrangler.test.jsonc sets PUBLIC_BLOG_DOMAIN=basedui.dev.
const BASE_DOMAIN = "basedui.dev";

async function insertDomain(fields: {
  id: string;
  siteId: string;
  hostname: string;
  type: string;
  status: string;
  basePath?: string;
}) {
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(fields.id, fields.siteId, fields.hostname, fields.type, fields.status, fields.basePath ?? null, T, T)
    .run();
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WORKSPACE_ID, "SPU Workspace", WORKSPACE_ID, T, T)
    .run();

  // Paid primaries below stay selectable only while this workspace is billed.
  await env.DB.prepare(
    "INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
  )
    .bind("bc-spu", WORKSPACE_ID, T + 1_000_000, T, T)
    .run();

  for (const id of [
    "site-spu-default", // default domain only
    "site-spu-custom", // default + custom
    "site-spu-subpath", // default + custom + subpath
    "site-spu-none", // no domains
    "site-spu-local", // stale local default hostname
  ]) {
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, WORKSPACE_ID, id, id, T, T)
      .run();
  }

  await insertDomain({
    id: "dom-spu-default",
    siteId: "site-spu-default",
    hostname: `site-spu-default.${BASE_DOMAIN}`,
    type: "default",
    status: "active",
  });

  await insertDomain({
    id: "dom-spu-c-default",
    siteId: "site-spu-custom",
    hostname: `site-spu-custom.${BASE_DOMAIN}`,
    type: "default",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-c-pending",
    siteId: "site-spu-custom",
    hostname: "pending.example.test",
    type: "custom",
    status: "pending",
  });
  await insertDomain({
    id: "dom-spu-c-custom",
    siteId: "site-spu-custom",
    hostname: "blog.example.test",
    type: "custom",
    status: "active",
  });

  await insertDomain({
    id: "dom-spu-s-default",
    siteId: "site-spu-subpath",
    hostname: `site-spu-subpath.${BASE_DOMAIN}`,
    type: "default",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-s-custom",
    siteId: "site-spu-subpath",
    hostname: "blog.subpath.test",
    type: "custom",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-s-subpath",
    siteId: "site-spu-subpath",
    hostname: "customer.test",
    type: "subpath",
    status: "active",
    basePath: "/blog",
  });

  await insertDomain({
    id: "dom-spu-local",
    siteId: "site-spu-local",
    hostname: "site-spu-local.localhost",
    type: "default",
    status: "active",
  });

  // Unentitled sites (no billing row, no sponsorship): paid mounts are
  // rejected by the public worker, so the URL must fall back to default.
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ws-spu-free", "SPU Free", "ws-spu-free", T, T)
    .run();
  for (const id of ["site-spu-free-custom", "site-spu-free-subpath"]) {
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, "ws-spu-free", id, id, T, T)
      .run();
  }
  await insertDomain({
    id: "dom-spu-fc-def",
    siteId: "site-spu-free-custom",
    hostname: `site-spu-free-custom.${BASE_DOMAIN}`,
    type: "default",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-fc-custom",
    siteId: "site-spu-free-custom",
    hostname: "paid-free.example.test",
    type: "custom",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-fs-def",
    siteId: "site-spu-free-subpath",
    hostname: `site-spu-free-subpath.${BASE_DOMAIN}`,
    type: "default",
    status: "active",
  });
  await insertDomain({
    id: "dom-spu-fs-subpath",
    siteId: "site-spu-free-subpath",
    hostname: "paid-mount.example.test",
    type: "subpath",
    status: "active",
    basePath: "/notes",
  });

  // Managed-sponsorship sites: active vs expired entitlement_expires_at. One
  // managed row per workspace (UNIQUE), so each site gets its own.
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind("user-spu-managed", "Managed Owner", "spu-managed@example.test", T, T)
    .run();
  for (const id of ["site-spu-managed-active", "site-spu-managed-expired"]) {
    const workspaceId = `ws-${id}`;
    await env.DB.prepare(
      "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(workspaceId, `SPU Managed ${id}`, workspaceId, T, T)
      .run();
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, workspaceId, id, id, T, T)
      .run();
    await env.DB.prepare(
      `INSERT INTO api_keys (
         id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(`key-${id}`, id, "Managed key", "prefix", `hash-${id}`, "[]", "Managed key", "user-spu-managed", T, T)
      .run();
    await insertDomain({
      id: `dom-${id}-def`,
      siteId: id,
      hostname: `${id}.${BASE_DOMAIN}`,
      type: "default",
      status: "active",
    });
    await insertDomain({
      id: `dom-${id}-custom`,
      siteId: id,
      hostname: `${id}.example.test`,
      type: "custom",
      status: "active",
    });
    await env.DB.prepare(
      `INSERT INTO autoseopilot_managed_sites (
         id, external_workspace_id, owner_user_id, workspace_id, site_id,
         credential_id, credential_generation, api_key_id, entitlement_status,
         entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', ?, 1, ?, ?, NULL)`,
    )
      .bind(
        `managed-${id}`,
        `ext-${id}`,
        "user-spu-managed",
        workspaceId,
        id,
        `cred-${id}`,
        `key-${id}`,
        // null = never expires; T < now = already lapsed.
        id.endsWith("-active") ? null : T,
        T,
        T,
      )
      .run();
  }
});

describe("getSitePublicBaseUrl — primary location precedence", () => {
  it("returns the default slug zone when only a default domain exists", async () => {
    expect(await getSitePublicBaseUrl("site-spu-default", "site-spu-default")).toBe(
      `https://site-spu-default.${BASE_DOMAIN}`,
    );
  });

  it("prefers an active custom domain and ignores a pending one", async () => {
    expect(await getSitePublicBaseUrl("site-spu-custom", "site-spu-custom")).toBe(
      "https://blog.example.test",
    );
  });

  it("prefers an active subpath and appends its base path", async () => {
    expect(await getSitePublicBaseUrl("site-spu-subpath", "site-spu-subpath")).toBe(
      "https://customer.test/blog",
    );
  });

  it("ignores non-active subpath rows and falls back to the next location", async () => {
    await insertDomain({
      id: "dom-spu-c-subpath-pending",
      siteId: "site-spu-custom",
      hostname: "subpath.example.test",
      type: "subpath",
      status: "pending",
      basePath: "/news",
    });
    expect(await getSitePublicBaseUrl("site-spu-custom", "site-spu-custom")).toBe(
      "https://blog.example.test",
    );
  });

  it("repairs a stale local default hostname to the slug zone", async () => {
    expect(await getSitePublicBaseUrl("site-spu-local", "site-spu-local")).toBe(
      `https://site-spu-local.${BASE_DOMAIN}`,
    );
  });

  it("returns null when the site has no active domain", async () => {
    expect(await getSitePublicBaseUrl("site-spu-none", "site-spu-none")).toBeNull();
  });
});

describe("getSitePublicBaseUrl — paid primaries need an effective entitlement", () => {
  it("falls back to the default host when a custom domain's billing lapsed", async () => {
    expect(await getSitePublicBaseUrl("site-spu-free-custom", "site-spu-free-custom")).toBe(
      `https://site-spu-free-custom.${BASE_DOMAIN}`,
    );
  });

  it("falls back to the default host when a subpath mount's billing lapsed", async () => {
    expect(await getSitePublicBaseUrl("site-spu-free-subpath", "site-spu-free-subpath")).toBe(
      `https://site-spu-free-subpath.${BASE_DOMAIN}`,
    );
  });

  it("picks the custom primary under an active managed sponsorship", async () => {
    expect(await getSitePublicBaseUrl("site-spu-managed-active", "site-spu-managed-active")).toBe(
      "https://site-spu-managed-active.example.test",
    );
  });

  it("falls back to the default host once the managed sponsorship expires", async () => {
    expect(await getSitePublicBaseUrl("site-spu-managed-expired", "site-spu-managed-expired")).toBe(
      `https://site-spu-managed-expired.${BASE_DOMAIN}`,
    );
  });
});

describe("getSiteAssetBaseUrl — always the default host", () => {
  it("stays on the slug zone when the primary is a custom domain", async () => {
    expect(await getSiteAssetBaseUrl("site-spu-custom", "site-spu-custom")).toBe(
      `https://site-spu-custom.${BASE_DOMAIN}`,
    );
  });

  it("stays on the slug zone when the primary is a subpath", async () => {
    expect(await getSiteAssetBaseUrl("site-spu-subpath", "site-spu-subpath")).toBe(
      `https://site-spu-subpath.${BASE_DOMAIN}`,
    );
  });
});

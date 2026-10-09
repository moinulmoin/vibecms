/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { getDashboardData } from "@/server/cms-dashboard";
import type { AppUserContext } from "@/server/onboarding";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

// IDs are file-scoped ("dsh-*") so this suite never collides with the other
// suites sharing the miniflare D1 instance.
const WORKSPACE_ID = "ws-dsh";
const T = 1_700_000_000;

function appFor(siteId: string): AppUserContext {
  return {
    user: { id: "user-dsh", name: "DSH User", email: "dsh@example.test" },
    siteId,
    workspaceId: WORKSPACE_ID,
    actor: { type: "human", id: "user-dsh", name: "DSH User", role: "owner" },
  };
}

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
    .bind(WORKSPACE_ID, "DSH Workspace", WORKSPACE_ID, T, T)
    .run();

  // An active custom domain is only the public URL while the workspace's
  // effective entitlement holds (same rule the public worker enforces).
  await env.DB.prepare(
    "INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
  )
    .bind("bc-dsh", WORKSPACE_ID, T + 1_000_000, T, T)
    .run();

  for (const id of [
    "site-dsh-custom", // local default + active custom primary
    "site-dsh-local", // local default only
    "site-dsh-default", // non-local default only
  ]) {
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, WORKSPACE_ID, id, id, T, T)
      .run();
  }

  await insertDomain({
    id: "dom-dsh-c-default",
    siteId: "site-dsh-custom",
    hostname: "site-dsh-custom.localhost",
    type: "default",
    status: "active",
  });
  await insertDomain({
    id: "dom-dsh-c-custom",
    siteId: "site-dsh-custom",
    hostname: "blog.customer.test",
    type: "custom",
    status: "active",
  });

  await insertDomain({
    id: "dom-dsh-local",
    siteId: "site-dsh-local",
    hostname: "site-dsh-local.localhost",
    type: "default",
    status: "active",
  });

  await insertDomain({
    id: "dom-dsh-default",
    siteId: "site-dsh-default",
    hostname: "site-dsh-default.basedui.dev",
    type: "default",
    status: "active",
  });
});

describe("getDashboardData — publicUrlLocal follows the resolved public URL", () => {
  // The reviewed bug only reproduces when PUBLIC_BLOG_DOMAIN is unset: with the
  // zone configured the app layer repaired the local hostname before checking
  // it. Env mutation mirrors public-blog-cache.test.ts (vars typed as literals).
  async function withoutPublicBlogDomain<T>(fn: () => Promise<T>): Promise<T> {
    const mutable = env as unknown as Record<string, string>;
    const previous = mutable.PUBLIC_BLOG_DOMAIN;
    mutable.PUBLIC_BLOG_DOMAIN = "";
    try {
      return await fn();
    } finally {
      mutable.PUBLIC_BLOG_DOMAIN = previous;
    }
  }

  it("marks a site live when the default host is local but an active custom domain is primary", async () => {
    const data = await withoutPublicBlogDomain(() => getDashboardData(appFor("site-dsh-custom")));
    expect(data.publicUrl).toBe("https://blog.customer.test");
    expect(data.publicUrlLocal).toBe(false);
  });

  it("marks a site local when only a local default host exists", async () => {
    const data = await withoutPublicBlogDomain(() => getDashboardData(appFor("site-dsh-local")));
    expect(data.publicUrl).toBe("http://site-dsh-local.localhost");
    expect(data.publicUrlLocal).toBe(true);
  });

  it("marks a site live when the default host is the configured slug zone", async () => {
    const data = await withoutPublicBlogDomain(() => getDashboardData(appFor("site-dsh-default")));
    expect(data.publicUrl).toBe("https://site-dsh-default.basedui.dev");
    expect(data.publicUrlLocal).toBe(false);
  });
});

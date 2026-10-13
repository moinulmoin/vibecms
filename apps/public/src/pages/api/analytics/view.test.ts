/// <reference types="@cloudflare/vitest-pool-workers" />
import type { APIContext } from "astro";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { POST } from "./view";
import type { PublicRuntimeEnv } from "../../../env";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}
/**
 * The beacon drops UAs on the shared agent table (plans/023 §1): a crawler
 * that runs JS must not be counted as a person. The 204 fires before the
 * Origin check, so these requests need no origin/body plumbing.
 */
function makeContext(request: Request): APIContext {
  return { request, locals: {}, url: new URL(request.url) } as unknown as APIContext;
}

const mutableEnv = env as unknown as Record<string, unknown>;

describe("analytics beacon agent filter", () => {
  it("ignores agent-table UAs with a 204 and never touches the dataset", async () => {
    const writeDataPoint = vi.fn();
    mutableEnv.ANALYTICS = { writeDataPoint };
    try {
      for (const ua of ["GPTBot/1.3", "Claude-User/1.0", "Googlebot/2.1", "curl/8.5.0"]) {
        const request = new Request("https://afa.basedui.dev/api/analytics/view", {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": ua },
          body: JSON.stringify({ slug: "hello" }),
        });
        const response = await POST(makeContext(request));
        expect(response.status, ua).toBe(204);
      }
      expect(writeDataPoint).not.toHaveBeenCalled();
    } finally {
      delete mutableEnv.ANALYTICS;
    }
  });

  it("still reaches the Origin check for ordinary browsers", async () => {
    const request = new Request("https://afa.basedui.dev/api/analytics/view", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({ slug: "hello" }),
    });
    const response = await POST(makeContext(request));
    expect(response.status).toBe(403);
  });
});

/**
 * Self-host gate (plans/023 §5): the beacon records only when the install has
 * the ANALYTICS binding plus the account/dataset/token query vars; without
 * them it silently drops views like before.
 */
describe("analytics beacon self-host", () => {
  const HOST = "beacon-selfhost.example.test";
  const T = 1_700_000_000;
  const selfHostedRuntime: PublicRuntimeEnv = {
    appUrl: "https://app.basedui.dev",
    publicBlogDomain: "basedui.dev",
    selfHosted: true,
    generatedCards: false,
  };

  function makeSelfHostContext(request: Request): APIContext {
    return { request, locals: { publicEnv: selfHostedRuntime }, url: new URL(request.url) } as unknown as APIContext;
  }

  function beaconRequest(): Request {
    return new Request(`https://${HOST}/api/analytics/view`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `https://${HOST}`,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({ slug: "hello" }),
    });
  }

  function restoreEnv(saved: Record<string, unknown>) {
    for (const key of ["ANALYTICS", "ANALYTICS_ACCOUNT_ID", "ANALYTICS_DATASET", "ANALYTICS_API_TOKEN"]) {
      if (saved[key] === undefined) delete mutableEnv[key];
      else mutableEnv[key] = saved[key];
    }
  }

  beforeAll(async () => {
    await applyD1Migrations(env.DB, inject("migrations"));
    const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
    await exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "ws-beacon", "Beacon", "ws-beacon", T, T);
    await exec("INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      "site-beacon", "ws-beacon", "Beacon Blog", "beacon", T, T);
    const columns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
    await exec(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 't', 'api_key', 't', ?, ?)`,
      "post-beacon-hello", "site-beacon", "Hello", "hello", "# Hello", T, T, T);
    const versionId = crypto.randomUUID();
    await exec(
      "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 't', 'seed', ?)",
      versionId, "post-beacon-hello", "site-beacon", "Hello", "hello", "# Hello", T);
    await exec("UPDATE posts SET published_version_id = ? WHERE id = ?", versionId, "post-beacon-hello");
  });

  it("records the view when the analytics env is configured", async () => {
    const saved = {
      ANALYTICS: mutableEnv.ANALYTICS,
      ANALYTICS_ACCOUNT_ID: mutableEnv.ANALYTICS_ACCOUNT_ID,
      ANALYTICS_DATASET: mutableEnv.ANALYTICS_DATASET,
      ANALYTICS_API_TOKEN: mutableEnv.ANALYTICS_API_TOKEN,
    };
    const writeDataPoint = vi.fn();
    mutableEnv.ANALYTICS = { writeDataPoint };
    mutableEnv.ANALYTICS_ACCOUNT_ID = "account";
    mutableEnv.ANALYTICS_DATASET = "dataset";
    mutableEnv.ANALYTICS_API_TOKEN = "token";
    try {
      const response = await POST(makeSelfHostContext(beaconRequest()));
      expect(response.status).toBe(204);
      expect(writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({ blobs: ["page_view", "post-beacon-hello", "hello", ""] }),
      );
    } finally {
      restoreEnv(saved);
    }
  });

  it("drops the view silently when the query vars are missing", async () => {
    const saved = {
      ANALYTICS: mutableEnv.ANALYTICS,
      ANALYTICS_ACCOUNT_ID: mutableEnv.ANALYTICS_ACCOUNT_ID,
      ANALYTICS_DATASET: mutableEnv.ANALYTICS_DATASET,
      ANALYTICS_API_TOKEN: mutableEnv.ANALYTICS_API_TOKEN,
    };
    const writeDataPoint = vi.fn();
    mutableEnv.ANALYTICS = { writeDataPoint };
    delete mutableEnv.ANALYTICS_ACCOUNT_ID;
    delete mutableEnv.ANALYTICS_DATASET;
    delete mutableEnv.ANALYTICS_API_TOKEN;
    try {
      const response = await POST(makeSelfHostContext(beaconRequest()));
      expect(response.status).toBe(204);
      expect(writeDataPoint).not.toHaveBeenCalled();
    } finally {
      restoreEnv(saved);
    }
  });
});

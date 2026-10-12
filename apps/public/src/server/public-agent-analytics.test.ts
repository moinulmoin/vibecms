/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Plans/023 phase 1: agent-table classification, the agent_fetch data point
 * layout, and waitUntil recording (direct + proxied hosts, failure safety).
 */
declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { agentForUserAgent, UNKNOWN_AGENT_ID } from "@vc/config/agents";
import {
  agentFetchSignal,
  recordAgentFetch,
  writeAgentFetch,
} from "./public-agent-analytics";
import { parsePublicRuntimeEnv } from "./public-url";
import type { PublicLocation } from "./public-location";

const runtimeEnv = parsePublicRuntimeEnv(env);
const T = 1_700_000_000;
const HOST = "afa.basedui.dev";
const SITE_ID = "site-afa";
const POST_ID = "post-afa-hello";

const directLocation: PublicLocation = {
  origin: `https://${HOST}`,
  basePath: "",
  assetOrigin: `https://${HOST}`,
  proxied: false,
};
const proxied: PublicLocation = {
  origin: "https://customer.example.com",
  basePath: "/blog",
  assetOrigin: `https://${HOST}`,
  proxied: true,
};

function get(path: string, init?: RequestInit): Request {
  return new Request(`https://${HOST}${path}`, { ...init, headers: { host: HOST, ...init?.headers } });
}

function datasetSpy() {
  const writeDataPoint = vi.fn();
  return { dataset: { writeDataPoint } as unknown as AnalyticsEngineDataset, writeDataPoint };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
  await exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    "ws-afa", "Afa", "ws-afa", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
    SITE_ID, "ws-afa", "Afa Blog", "afa", T, T);
  await exec("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    "bc-afa", "ws-afa", T, T);
  await exec("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)",
    "dom-afa", SITE_ID, HOST, T, T);
  const columns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  await exec(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'afa-test', 'api_key', 'afa-test', ?, ?)`,
    POST_ID, SITE_ID, "Hello", "hello", "# Hello", T, T, T);
  const versionId = crypto.randomUUID();
  await exec(
    "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'afa-test', 'seed', ?)",
    versionId, POST_ID, SITE_ID, "Hello", "hello", "# Hello", T);
  await exec("UPDATE posts SET published_version_id = ? WHERE id = ?", versionId, POST_ID);
});

describe("agent table classification", () => {
  it.each([
    ["Mozilla/5.0 (compatible; GPTBot/1.3)", "GPTBot", "ai-training"],
    ["Claude-User/1.0", "Claude-User", "ai-assistant"],
    ["Perplexity-User/1.0", "Perplexity-User", "ai-assistant"],
    ["OAI-SearchBot/1.0", "OAI-SearchBot", "ai-search"],
    ["CCBot/2.0", "CCBot", "ai-training"],
    ["meta-externalagent/1.1", "meta-externalagent", "ai-training"],
    ["Applebot-Extended", "Applebot-Extended", "ai-training"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1)", "Googlebot", "search-engine"],
    ["DuckDuckBot/1.1", "DuckDuckBot", "search-engine"],
    ["curl/8.5.0", "curl", "other-bot"],
    ["python-requests/2.31", "python-requests", "other-bot"],
    ["Go-http-client/1.1", "go-http-client", "other-bot"],
    ["SomeRandomCrawler/1.0", "generic-bot", "other-bot"],
  ])("classifies %s as %s/%s", (ua, id, category) => {
    expect(agentForUserAgent(ua)).toMatchObject({ id, category });
  });

  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ])("never relabels a mainstream browser: %s", (ua) => {
    expect(agentForUserAgent(ua)).toBeNull();
  });
});

describe("agentFetchSignal", () => {
  it("counts markdown, llms/feed/sitemap/robots, and Signature-Agent as agents without a UA match", () => {
    expect(agentFetchSignal(get("/hello.md"), "/hello.md")).toMatchObject({
      resource: "post", representation: "markdown", agentId: UNKNOWN_AGENT_ID, category: "unknown-agent", postSlug: "hello",
    });
    expect(agentFetchSignal(get("/hello?format=md"), "/hello")).toMatchObject({ representation: "markdown" });
    expect(agentFetchSignal(get("/hello", { headers: { accept: "text/markdown" } }), "/hello"))
      .toMatchObject({ representation: "markdown", category: "unknown-agent" });
    for (const path of ["/llms.txt", "/llms-full.txt", "/feed.xml", "/sitemap.xml", "/robots.txt"]) {
      expect(agentFetchSignal(get(path), path), path).not.toBeNull();
    }
    expect(agentFetchSignal(get("/", { headers: { "signature-agent": "https://agent.example/key" } }), "/"))
      .toMatchObject({ signed: true, category: "unknown-agent" });
  });

  it("writes nothing for a plain browser HTML GET", () => {
    const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
    expect(agentFetchSignal(get("/hello", { headers: { "user-agent": browser } }), "/hello")).toBeNull();
    expect(agentFetchSignal(get("/", { headers: { "user-agent": browser } }), "/")).toBeNull();
  });

  it("skips non-GET, infra paths, and maps resources", () => {
    const gpt = { headers: { "user-agent": "GPTBot/1.3" } };
    expect(agentFetchSignal(new Request(`https://${HOST}/hello`, { method: "POST", headers: gpt.headers }), "/hello")).toBeNull();
    for (const path of ["/api/analytics/view", "/_vc/p/abc/hello", "/_astro/app.js", "/docs/api", "/preview/tok", "/media-assets/a1", "/og.png", "/internal/tenant"]) {
      expect(agentFetchSignal(get(path, gpt), path), path).toBeNull();
    }
    expect(agentFetchSignal(get("/tag/news", gpt), "/tag/news")).toMatchObject({ resource: "tag" });
    expect(agentFetchSignal(get("/?q=llm", gpt), "/")).toMatchObject({ resource: "search" });
    expect(agentFetchSignal(get("/", gpt), "/")).toMatchObject({ resource: "index" });
    expect(agentFetchSignal(get("/hello", gpt), "/hello")).toMatchObject({
      resource: "post", agentId: "GPTBot", category: "ai-training", postSlug: "hello",
    });
  });

  it("keeps legacy /docs and /internal tenant posts readable while skipping infra descendants", () => {
    const gpt = { headers: { "user-agent": "GPTBot/1.3" } };
    for (const path of ["/docs", "/internal"]) {
      expect(agentFetchSignal(get(path, gpt), path), path).toMatchObject({
        resource: "post", agentId: "GPTBot", postSlug: path.slice(1),
      });
    }
    for (const path of ["/docs.md", "/internal.md"]) {
      expect(agentFetchSignal(get(path, gpt), path), path).toMatchObject({
        resource: "post", representation: "markdown", postSlug: path.slice(1, -3),
      });
    }
    for (const path of ["/docs/api", "/docs/getting-started", "/internal/tenant", "/internal/marketing"]) {
      expect(agentFetchSignal(get(path, gpt), path), path).toBeNull();
    }
  });
});

describe("agent_fetch data point", () => {
  it("writes the plans/023 blob layout", () => {
    const { dataset, writeDataPoint } = datasetSpy();
    writeAgentFetch(dataset, {
      siteId: SITE_ID,
      postId: POST_ID,
      host: "customer.example.com",
      signal: {
        resource: "post", representation: "markdown", postSlug: "hello",
        agentId: "ChatGPT-User", category: "ai-assistant", signed: true,
      },
    });
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [SITE_ID],
      blobs: ["agent_fetch", POST_ID, "post", "ChatGPT-User", "ai-assistant", "markdown", "1", "customer.example.com"],
      doubles: [1],
    });
  });
});

describe("recordAgentFetch", () => {
  const scheduled: Promise<unknown>[] = [];
  function record(request: Request, response: Response, location: PublicLocation, publicPath: string, dataset: AnalyticsEngineDataset) {
    scheduled.length = 0;
    return recordAgentFetch({
      request, response, publicPath, location,
      env: { ...env, ANALYTICS: dataset } as unknown as Env,
      runtime: runtimeEnv,
      waitUntil: (promise) => scheduled.push(promise),
    });
  }

  it("writes a direct request with the tenant host and resolved post id", async () => {
    const { dataset, writeDataPoint } = datasetSpy();
    const job = record(get("/hello", { headers: { "user-agent": "GPTBot/1.3" } }), new Response("ok"), directLocation, "/hello", dataset);
    expect(job).not.toBeNull();
    expect(scheduled).toHaveLength(1);
    await job;
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [SITE_ID],
      blobs: ["agent_fetch", POST_ID, "post", "GPTBot", "ai-training", "html", "", HOST],
      doubles: [1],
    });
  });

  it("writes a proxied request with the customer host, not ours", async () => {
    const { dataset, writeDataPoint } = datasetSpy();
    const request = get("/llms.txt", { headers: { "user-agent": "Claude-User/1.0" } });
    await record(request, new Response("ok"), proxied, "/llms.txt", dataset);
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({ blobs: expect.arrayContaining(["llms", "Claude-User", "customer.example.com"]) }),
    );
  });

  it("does not record non-200 responses, browsers, or missing sites", async () => {
    const { dataset, writeDataPoint } = datasetSpy();
    const gpt = { headers: { "user-agent": "GPTBot/1.3" } };
    expect(await record(get("/hello", gpt), new Response("no", { status: 404 }), directLocation, "/hello", dataset)).toBeNull();
    expect(await record(get("/hello", gpt), new Response("gone", { status: 500 }), directLocation, "/hello", dataset)).toBeNull();
    const browser = { headers: { "user-agent": "Mozilla/5.0 Chrome/126.0" } };
    expect(await record(get("/hello", browser), new Response("ok"), directLocation, "/hello", dataset)).toBeNull();
    // Unknown host → no site → the job still resolves without a write.
    const unknownHost = new Request("https://nobody.example/hello", { headers: { host: "nobody.example", "user-agent": "GPTBot/1.3" } });
    await record(unknownHost, new Response("ok"), { ...directLocation, origin: "https://nobody.example" }, "/hello", dataset);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("never lets a write failure change the response", async () => {
    const writeDataPoint = vi.fn(() => { throw new Error("ae_down"); });
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
    const job = record(get("/hello", { headers: { "user-agent": "GPTBot/1.3" } }), new Response("ok"), directLocation, "/hello", dataset);
    await expect(job!).resolves.toBeUndefined();
    expect(writeDataPoint).toHaveBeenCalled();
  });

  it("does nothing when the ANALYTICS binding is absent (self-host opt-in)", async () => {
    const missing = { ...env, ANALYTICS: undefined } as unknown as Env;
    expect(recordAgentFetch({
      request: get("/hello", { headers: { "user-agent": "GPTBot/1.3" } }),
      response: new Response("ok"), publicPath: "/hello", location: directLocation,
      env: missing, runtime: runtimeEnv,
    })).toBeNull();
  });
});

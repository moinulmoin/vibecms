/// <reference types="@cloudflare/vitest-pool-workers" />
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

vi.mock("astro:middleware", () => ({ defineMiddleware: <T>(handler: T) => handler }));

const { onRequest } = await import("../middleware");

const KEY = "5e7a1c9b3d2f4a6c8e0b1d3f5a7c9e2b";
// The global Env declares INDEXNOW_KEY; the cloudflare:workers export is typed separately.
const settings = env as unknown as Env;
const previousKey = settings.INDEXNOW_KEY;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
});

afterEach(() => {
  settings.INDEXNOW_KEY = previousKey;
});

async function request(host: string, path: string) {
  const url = new URL("https://" + host + path);
  const req = new Request(url, { headers: { host } });
  const next = async () => new Response("from the page", { status: 404, headers: { "content-type": "text/plain" } });
  const handler = onRequest as unknown as (context: unknown, next: () => Promise<Response>) => Promise<Response>;
  return handler({ request: req, url, locals: {}, params: {} }, next);
}

describe("public worker IndexNow key route", () => {
  it("answers the configured key on a blog host before any page handler", async () => {
    settings.INDEXNOW_KEY = KEY;
    const response = await request("hello.basedui.dev", "/" + KEY + ".txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(KEY);
  });

  it("leaves the path to the pages when no key is configured", async () => {
    settings.INDEXNOW_KEY = undefined;
    const response = await request("hello.basedui.dev", "/" + KEY + ".txt");
    expect(await response.text()).not.toBe(KEY);
  });
});

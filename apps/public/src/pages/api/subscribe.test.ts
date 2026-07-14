/// <reference types="@cloudflare/vitest-pool-workers" />
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./subscribe";

/**
 * The public Astro proxy forwards newsletter writes to the API Worker through
 * its `API` service binding. `wrangler.test.jsonc` declares no `API` binding,
 * so the binding is `undefined` in tests; we install a recording fake `Fetcher`
 * on the module `env` (the exact object `apiBinding(context)` resolves to) so
 * the real `apiBinding -> workerEnv -> env.API` path runs with no network.
 */
const forwarded: Request[] = [];
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

/** Smallest APIContext the handler needs: it reads `request.headers` + `request.body`. */
function makeContext(payload: unknown, headers: Record<string, string> = {}): APIContext {
  const request = new Request("https://acme.basedui.dev/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  // APIContext has many members irrelevant to this handler; cast the minimal shape.
  return { request, locals: {} } as unknown as APIContext;
}

const PAYLOAD = {
  email: "reader@example.com",
  siteSlug: "acme",
  company: "Acme Inc",
  consentVersion: "1",
  consentText:
    "By submitting your email you agree to receive a notification when email delivery launches. No marketing emails.",
  source: "https://acme.basedui.dev/",
};

beforeEach(() => {
  forwarded.length = 0;
  fetchMock.mockReset();
  // `apiBinding(context)` resolves to the module env's `API` binding; install the fake.
  (env as unknown as Record<string, unknown>).API = { fetch: fetchMock };
});

afterEach(() => {
  // `API` is not a declared binding in the test config; remove it to restore.
  delete (env as unknown as Record<string, unknown>).API;
});

describe("subscribe proxy POST handler", () => {
  it("forwards the browser POST to the API binding at /api/subscribe with body, consent, and source intact", async () => {
    const inner = new Response(JSON.stringify({ ok: true, created: true }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
    fetchMock.mockImplementation(async (request) => {
      forwarded.push(request.clone() as unknown as Request);
      return inner;
    });
    const context = makeContext(PAYLOAD, { referer: PAYLOAD.source });

    const res = await POST(context);

    // Forwarded exactly once to the internal service binding.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fwd = forwarded[0]!;

    // Method + internal route preserved.
    expect(fwd.method).toBe("POST");
    expect(fwd.url).toBe("https://vibecms-api.internal/api/subscribe");
    expect(new URL(fwd.url).pathname).toBe("/api/subscribe");

    // Content type preserved through the forwarded request.
    expect(fwd.headers.get("content-type")).toBe("application/json");

    // siteSlug, consent context, and the source URL (body + referer) carried verbatim.
    expect(await fwd.json()).toEqual(PAYLOAD);
    expect(fwd.headers.get("referer")).toBe(PAYLOAD.source);

    // The handler returns the internal API response unchanged (same object).
    expect(res).toBe(inner);
    expect(res.status).toBe(202);
  });

  it("returns the API binding's 4xx response unchanged", async () => {
    const inner = new Response(JSON.stringify({ error: "invalid_email" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    fetchMock.mockImplementation(async (request) => {
      forwarded.push(request.clone() as unknown as Request);
      return inner;
    });
    const context = makeContext(PAYLOAD, { referer: PAYLOAD.source });

    const res = await POST(context);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forwarded[0]!.url).toBe("https://vibecms-api.internal/api/subscribe");
    // 4xx is passed straight through, status and body untouched.
    expect(res).toBe(inner);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ error: "invalid_email" }));
  });
});

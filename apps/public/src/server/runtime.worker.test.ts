/// <reference types="@cloudflare/vitest-pool-workers" />
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { apiBinding, publicAssetsBucket, publicDb, publicImages, publicRuntimeEnv, workerEnv } from "./runtime";

describe("Astro Cloudflare runtime bindings", () => {
  it("uses module bindings when Astro locals do not expose the removed runtime object", () => {
    const context = { locals: {} } as APIContext;

    expect(workerEnv(context)).toBe(env);
    expect(publicDb(context)).toBe(env.DB);
    expect(publicAssetsBucket(context)).toBe(env.ASSETS_BUCKET);
    // Present when wrangler.test.jsonc binds IMAGES; self-host may omit it.
    expect(publicImages(context)).toBe(env.IMAGES);
    expect(apiBinding(context)).toBe(env.API);
    expect(publicRuntimeEnv(context)).toMatchObject({
      appUrl: "https://app.basedui.dev",
      publicBlogDomain: "basedui.dev",
      selfHosted: false,
    });
  });
});

describe("public runtime env resolution", () => {
  it("memoizes the parsed env into locals so a single request resolves it once", () => {
    const context = { locals: {} } as APIContext;
    const first = publicRuntimeEnv(context);

    // First resolution must be cached onto locals for reuse within the request.
    expect(context.locals.publicEnv).toBe(first);

    // A second access returns the same object rather than re-parsing env.
    expect(publicRuntimeEnv(context)).toBe(first);
  });

  it("returns a pre-resolved locals env without re-parsing (self-host single-site)", () => {
    const cachedEnv = {
      appUrl: "https://self.basedui.dev",
      publicBlogDomain: "self.basedui.dev",
      selfHosted: true,
    };
    const context = { locals: { publicEnv: cachedEnv } } as APIContext;

    // Middleware that already resolved a fixed single-site env must win; the
    // runtime must not overwrite it by re-parsing the module env.
    expect(publicRuntimeEnv(context)).toBe(cachedEnv);
    expect(publicRuntimeEnv(context).selfHosted).toBe(true);
  });

  it("derives selfHosted from the configured SELF_HOSTED var, not a hardcode", () => {
    const context = { locals: {} } as APIContext;

    // The test runtime sets SELF_HOSTED=false; a multi-tenant deployment must
    // not report itself as a self-hosted single site.
    expect(publicRuntimeEnv(context).selfHosted).toBe(false);
  });
});

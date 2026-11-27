import { describe, expect, it } from "vitest";
import type { PublicRuntimeEnv } from "../env";
import { indexNowKeyFile } from "./indexnow-key";

const KEY = "0f3c9a5e8b7d4c2a9e1f6b3d8c5a7e2f";
const base: PublicRuntimeEnv = { appUrl: "https://app.basedui.dev", publicBlogDomain: "basedui.dev", selfHosted: false, generatedCards: false };
const configured: PublicRuntimeEnv = { ...base, indexNowKey: KEY };

function get(host: string, path: string, method = "GET") {
  return new Request("https://" + host + path, { method, headers: { host } });
}

describe("IndexNow key file", () => {
  it("serves the exact key as plain text on a blog host", async () => {
    for (const host of ["hello.basedui.dev", "blog.customer.test"]) {
      const response = indexNowKeyFile(get(host, "/" + KEY + ".txt"), "/" + KEY + ".txt", configured);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await response?.text()).toBe(KEY);
    }
  });

  it("serves it at the blog-relative root of a subpath blog", async () => {
    // A proxied customer.com/blog/<key>.txt reaches the worker as the stripped blog path.
    const response = indexNowKeyFile(get("vibecms-public.basedui.dev", "/_vc/p/proxyid000000000001/" + KEY + ".txt"), "/" + KEY + ".txt", configured);
    expect(await response?.text()).toBe(KEY);
  });

  it("answers HEAD without a body", async () => {
    const response = indexNowKeyFile(get("hello.basedui.dev", "/" + KEY + ".txt", "HEAD"), "/" + KEY + ".txt", configured);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("");
  });

  it("serves nothing when no key is configured", () => {
    expect(indexNowKeyFile(get("hello.basedui.dev", "/" + KEY + ".txt"), "/" + KEY + ".txt", base)).toBeNull();
    expect(indexNowKeyFile(get("hello.basedui.dev", "/" + KEY + ".txt"), "/" + KEY + ".txt", { ...base, indexNowKey: null })).toBeNull();
  });

  it("serves nothing for any other path", () => {
    for (const path of ["/other.txt", "/" + KEY.toUpperCase() + ".txt", "/" + KEY, "/" + KEY + ".txt/", "/x/" + KEY + ".txt", "/" + KEY + ".md", "/" + KEY + ".txt.txt"]) {
      expect(indexNowKeyFile(get("hello.basedui.dev", path), path, configured), path).toBeNull();
    }
    expect(indexNowKeyFile(get("hello.basedui.dev", "/" + KEY + ".txt", "POST"), "/" + KEY + ".txt", configured)).toBeNull();
  });

  it("serves nothing on the product's own hosts", () => {
    for (const host of ["basedui.dev", "app.basedui.dev"]) {
      expect(indexNowKeyFile(get(host, "/" + KEY + ".txt"), "/" + KEY + ".txt", configured), host).toBeNull();
    }
  });
});

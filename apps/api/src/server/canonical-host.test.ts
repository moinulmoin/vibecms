import { describe, expect, it } from "vitest";
import { isAppContextHost, resolveCanonicalRedirect } from "@/server/canonical-host";

const APP_HOST = { appHost: "app.vibecms.dev" };
const req = (url: string, method = "GET") => new Request(url, { method });

describe("resolveCanonicalRedirect", () => {
  it("sends the app-host root to /dashboard", () => {
    const response = resolveCanonicalRedirect(req("https://app.vibecms.dev/"), APP_HOST);
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://app.vibecms.dev/dashboard");
  });

  it("leaves app/auth surfaces on the app host untouched", () => {
    expect(resolveCanonicalRedirect(req("https://app.vibecms.dev/dashboard"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://app.vibecms.dev/dashboard/posts"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://app.vibecms.dev/login"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://app.vibecms.dev/api/auth/get-session"), APP_HOST)).toBeUndefined();
  });

  it("leaves marketing and tenant blog content untouched on their own hosts", () => {
    expect(resolveCanonicalRedirect(req("https://vibecms.dev/"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://vibecms.dev/pricing"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://acme.vibecms.dev/"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://acme.vibecms.dev/my-post"), APP_HOST)).toBeUndefined();
  });

  it("redirects GET app surfaces off apex/tenant hosts, preserving path and query", () => {
    expect(resolveCanonicalRedirect(req("https://vibecms.dev/login"), APP_HOST)?.headers.get("location")).toBe(
      "https://app.vibecms.dev/login",
    );
    expect(
      resolveCanonicalRedirect(req("https://acme.vibecms.dev/dashboard/posts?status=draft"), APP_HOST)?.headers.get(
        "location",
      ),
    ).toBe("https://app.vibecms.dev/dashboard/posts?status=draft");
  });

  it("refuses non-idempotent app-surface requests on the wrong host with 404", () => {
    expect(resolveCanonicalRedirect(req("https://vibecms.dev/api/auth/sign-in/email", "POST"), APP_HOST)?.status).toBe(404);
    expect(resolveCanonicalRedirect(req("https://acme.vibecms.dev/api/auth/sign-in/email", "POST"), APP_HOST)?.status).toBe(404);
  });

  it("does not treat lookalike paths as app surfaces", () => {
    expect(resolveCanonicalRedirect(req("https://acme.vibecms.dev/dashboards"), APP_HOST)).toBeUndefined();
    expect(resolveCanonicalRedirect(req("https://acme.vibecms.dev/api/authority"), APP_HOST)).toBeUndefined();
  });

  it("never redirects localhost during local dev", () => {
    expect(resolveCanonicalRedirect(req("http://localhost:5173/login"), APP_HOST)).toBeUndefined();
  });
});

describe("isAppContextHost", () => {
  it("allows only the app host plus localhost dev", () => {
    expect(isAppContextHost("app.vibecms.dev", APP_HOST)).toBe(true);
    expect(isAppContextHost("vibecms.dev", APP_HOST)).toBe(false);
    expect(isAppContextHost("acme.vibecms.dev", APP_HOST)).toBe(false);
    expect(isAppContextHost("localhost", APP_HOST)).toBe(true);
  });

  it("fails closed when the app host cannot be derived", () => {
    expect(isAppContextHost("vibecms.dev", { appHost: "" })).toBe(false);
    expect(isAppContextHost("app.vibecms.dev", { appHost: "" })).toBe(false);
  });
});

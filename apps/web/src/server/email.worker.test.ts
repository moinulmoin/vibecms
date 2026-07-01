/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// sendOtpEmail fallback when no email provider is configured: hosted prod throws,
// self-host prod logs the code (documented passwordless self-host path).
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { sendOtpEmail } from "./email";

// Test config pins vars to literal types; widen for per-test overrides.
const mut = env as unknown as Record<string, string | undefined>;
const saved = { APP_ENV: env.APP_ENV, SELF_HOSTED: env.SELF_HOSTED, CLOUDFLARE_EMAIL_API_TOKEN: env.CLOUDFLARE_EMAIL_API_TOKEN };

afterEach(() => {
  mut.APP_ENV = saved.APP_ENV;
  mut.SELF_HOSTED = saved.SELF_HOSTED;
  mut.CLOUDFLARE_EMAIL_API_TOKEN = saved.CLOUDFLARE_EMAIL_API_TOKEN;
  vi.restoreAllMocks();
});

describe("sendOtpEmail without an email provider", () => {
  it("throws in hosted production", async () => {
    mut.APP_ENV = "production";
    mut.SELF_HOSTED = "false";
    mut.CLOUDFLARE_EMAIL_API_TOKEN = undefined;
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).rejects.toThrow(/email provider/);
  });

  it("logs the code in self-host production", async () => {
    mut.APP_ENV = "production";
    mut.SELF_HOSTED = "true";
    mut.CLOUDFLARE_EMAIL_API_TOKEN = undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});

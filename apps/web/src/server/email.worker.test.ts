/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// sendOtpEmail: native send_email binding path + fallback when the binding is absent
// (hosted prod throws, self-host prod logs the code).
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { sendOtpEmail } from "./email";

// Test config pins vars to literal types; widen for per-test overrides (EMAIL may be a binding, a stub, or undefined).
const mut = env as unknown as Record<string, unknown>;
const saved = {
  APP_ENV: env.APP_ENV,
  SELF_HOSTED: env.SELF_HOSTED,
  EMAIL: env.EMAIL,
  EMAIL_FROM: env.EMAIL_FROM,
};

afterEach(() => {
  mut.APP_ENV = saved.APP_ENV;
  mut.SELF_HOSTED = saved.SELF_HOSTED;
  mut.EMAIL = saved.EMAIL;
  mut.EMAIL_FROM = saved.EMAIL_FROM;
  vi.restoreAllMocks();
});

describe("sendOtpEmail without an EMAIL binding", () => {
  it("throws in hosted production", async () => {
    mut.APP_ENV = "production";
    mut.SELF_HOSTED = "false";
    mut.EMAIL = undefined;
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).rejects.toThrow(/email not configured/);
  });

  it("logs the code in self-host production", async () => {
    mut.APP_ENV = "production";
    mut.SELF_HOSTED = "true";
    mut.EMAIL = undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});

describe("sendOtpEmail with the EMAIL binding", () => {
  it("sends via the binding and logs the OTP in development", async () => {
    mut.APP_ENV = "development";
    mut.EMAIL_FROM = undefined; // exercise the DEFAULT_FROM path
    const send = vi.fn().mockResolvedValue({ messageId: "m1" });
    mut.EMAIL = { send };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendOtpEmail("user@example.com", "123456", "sign-in");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: "user@example.com",
      from: { email: "hey@vibecms.dev", name: "vibecms" },
      subject: "Your vibecms sign-in code",
      html: expect.stringContaining("123456"),
      text: expect.stringContaining("123456"),
    });
    // Non-prod logs the OTP even when the binding is present (local miniflare / dev QA visibility).
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});

/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { sendOtpEmail } from "@/server/email";

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = {
  APP_ENV: env.APP_ENV,
  SELF_HOSTED: env.SELF_HOSTED,
  EMAIL: env.EMAIL,
  EMAIL_FROM: env.EMAIL_FROM,
};

afterEach(() => {
  mutableEnv.APP_ENV = saved.APP_ENV;
  mutableEnv.SELF_HOSTED = saved.SELF_HOSTED;
  mutableEnv.EMAIL = saved.EMAIL;
  mutableEnv.EMAIL_FROM = saved.EMAIL_FROM;
  vi.restoreAllMocks();
});

describe("sendOtpEmail without an EMAIL binding", () => {
  it("throws in hosted production", async () => {
    mutableEnv.APP_ENV = "production";
    mutableEnv.SELF_HOSTED = "false";
    mutableEnv.EMAIL = undefined;
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).rejects.toThrow(/email not configured/);
  });

  it("logs the code in self-host production", async () => {
    mutableEnv.APP_ENV = "production";
    mutableEnv.SELF_HOSTED = "true";
    mutableEnv.EMAIL = undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendOtpEmail("user@example.com", "123456", "sign-in")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});

describe("sendOtpEmail with the EMAIL binding", () => {
  it("sends via the binding and logs the OTP in development", async () => {
    mutableEnv.APP_ENV = "development";
    mutableEnv.EMAIL_FROM = undefined;
    const send = vi.fn().mockResolvedValue({ messageId: "m1" });
    mutableEnv.EMAIL = { send };
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
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });
});

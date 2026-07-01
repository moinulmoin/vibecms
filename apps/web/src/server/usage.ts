import { API_USAGE_LIMITS } from "@vc/config";
import { RateLimitError, type BillingStatus } from "@vc/core";
import { env } from "cloudflare:workers";
import { createDataAccess, type UsageRepository } from "@vc/db";
import { getBillingStatus, isSelfHosted } from "./billing";

export type ApiUsageKind = "read" | "write";
export type ApiUsageStatus = { metric: string; period: string; used: number; limit: number; remaining: number; resetsAt: number };
export type ApiUsageSummary = {
  enforced: boolean;
  billingStatus: BillingStatus;
  calls: { minute: ApiUsageStatus; day: ApiUsageStatus; month: ApiUsageStatus };
  writes: { day: ApiUsageStatus; month: ApiUsageStatus };
  token: { minute: ApiUsageStatus } | null;
};

type PeriodName = "minute" | "day" | "month";
type PeriodWindow = { name: PeriodName; period: string; resetsAt: number };
type LimitPlan = { calls: { minute: number; day: number; month: number }; writes: { day: number; month: number }; token: { minute: number } };
type UsageCounter = { id: string; workspaceId: string; siteId: string | null; metric: string; period: PeriodWindow; limit: number };

const CALLS_METRIC = "calls";
const WRITES_METRIC = "writes";

function now() {
  return Math.floor(Date.now() / 1000);
}

function windows(at = new Date()): Record<PeriodName, PeriodWindow> {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();
  const hour = at.getUTCHours();
  const minute = at.getUTCMinutes();
  const monthNumber = String(month + 1).padStart(2, "0");
  const dayNumber = String(day).padStart(2, "0");
  const hourNumber = String(hour).padStart(2, "0");
  const minuteNumber = String(minute).padStart(2, "0");
  return {
    minute: {
      name: "minute",
      period: `${year}-${monthNumber}-${dayNumber}T${hourNumber}:${minuteNumber}Z`,
      resetsAt: Math.floor(Date.UTC(year, month, day, hour, minute + 1, 0, 0) / 1000),
    },
    day: {
      name: "day",
      period: `${year}-${monthNumber}-${dayNumber}`,
      resetsAt: Math.floor(Date.UTC(year, month, day + 1, 0, 0, 0, 0) / 1000),
    },
    month: {
      name: "month",
      period: `${year}-${monthNumber}`,
      resetsAt: Math.floor(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) / 1000),
    },
  };
}

function testLimitPlan(): LimitPlan | null {
  if (String(env.APP_ENV) === "production") return null;
  const limit = Number(env.API_USAGE_TEST_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) return null;
  return {
    calls: { minute: limit, day: limit, month: limit },
    writes: { day: limit, month: limit },
    token: { minute: limit },
  };
}

function planFor(status?: BillingStatus): LimitPlan {
  const testPlan = testLimitPlan();
  if (testPlan) return testPlan;
  if (String(env.APP_ENV) === "development" || String(env.APP_ENV) === "test") return API_USAGE_LIMITS.dev;
  return status === "active" ? API_USAGE_LIMITS.paid : API_USAGE_LIMITS.free;
}

function workspaceCounterId(workspaceId: string, metric: string, period: string) {
  return `workspace:${workspaceId}:${metric}:${period}`;
}

function tokenCounterId(tokenId: string, metric: string, period: string) {
  return `token:${tokenId}:${metric}:${period}`;
}

function status(metric: string, period: PeriodWindow, used: number, limit: number): ApiUsageStatus {
  return { metric, period: period.period, used, limit, remaining: Math.max(limit - used, 0), resetsAt: period.resetsAt };
}

async function readCounter(usage: UsageRepository, id: string) {
  return usage.readCounter(id);
}

async function readStatus(usage: UsageRepository, id: string, metric: string, period: PeriodWindow, limit: number) {
  return status(metric, period, await readCounter(usage, id), limit);
}

function errorFor(limitStatus: ApiUsageStatus) {
  return Object.assign(new RateLimitError(), { usageStatus: limitStatus });
}

async function assertUnderLimit(usage: UsageRepository, counterId: string, metric: string, period: PeriodWindow, limit: number) {
  const used = await readCounter(usage, counterId);
  if (used >= limit) throw errorFor(status(metric, period, used, limit));
}

async function incrementCounter(usage: UsageRepository, input: UsageCounter) {
  // Guarded upsert: applied=false means the value+1<=limit guard rejected the increment (limit reached => deny).
  const { applied } = await usage.incrementCounter({
    id: input.id,
    workspaceId: input.workspaceId,
    siteId: input.siteId,
    period: input.period.period,
    metric: input.metric,
    limit: input.limit,
  });
  if (!applied) {
    const used = await readCounter(usage, input.id);
    throw errorFor(status(input.metric, input.period, used, input.limit));
  }
}

async function releaseCounter(usage: UsageRepository, input: UsageCounter) {
  await usage.releaseCounter(input.id);
}

async function reserveCounters(usage: UsageRepository, counters: UsageCounter[]) {
  for (const counter of counters) await assertUnderLimit(usage, counter.id, counter.metric, counter.period, counter.limit);
  const reserved: UsageCounter[] = [];
  try {
    for (const counter of counters) {
      await incrementCounter(usage, counter);
      reserved.push(counter);
    }
  } catch (error) {
    await Promise.all(reserved.map((counter) => releaseCounter(usage, counter)));
    throw error;
  }
}

export function apiRateLimitHeaders(error: unknown): HeadersInit | undefined {
  const usageStatus = error instanceof RateLimitError ? (error as RateLimitError & { usageStatus?: ApiUsageStatus }).usageStatus : undefined;
  if (!usageStatus) return undefined;
  return {
    "Retry-After": String(Math.max(1, usageStatus.resetsAt - now())),
    "X-RateLimit-Limit": String(usageStatus.limit),
    "X-RateLimit-Remaining": String(usageStatus.remaining),
    "X-RateLimit-Reset": String(usageStatus.resetsAt),
    "X-RateLimit-Metric": usageStatus.metric,
    "X-RateLimit-Period": usageStatus.period,
  };
}

export async function enforceApiBudget(input: { workspaceId: string; siteId: string; tokenId: string; kind: ApiUsageKind; force?: boolean }): Promise<void> {
  if (isSelfHosted() && !input.force) return;
  const limits = planFor(await getBillingStatus(input.workspaceId));
  const period = windows();
  const counters: UsageCounter[] = [
    { id: workspaceCounterId(input.workspaceId, CALLS_METRIC, period.minute.period), workspaceId: input.workspaceId, siteId: null, metric: CALLS_METRIC, period: period.minute, limit: limits.calls.minute },
    { id: tokenCounterId(input.tokenId, CALLS_METRIC, period.minute.period), workspaceId: input.workspaceId, siteId: input.siteId, metric: CALLS_METRIC, period: period.minute, limit: limits.token.minute },
    { id: workspaceCounterId(input.workspaceId, CALLS_METRIC, period.day.period), workspaceId: input.workspaceId, siteId: null, metric: CALLS_METRIC, period: period.day, limit: limits.calls.day },
    { id: workspaceCounterId(input.workspaceId, CALLS_METRIC, period.month.period), workspaceId: input.workspaceId, siteId: null, metric: CALLS_METRIC, period: period.month, limit: limits.calls.month },
    ...(input.kind === "write" ? [
      { id: workspaceCounterId(input.workspaceId, WRITES_METRIC, period.day.period), workspaceId: input.workspaceId, siteId: null, metric: WRITES_METRIC, period: period.day, limit: limits.writes.day },
      { id: workspaceCounterId(input.workspaceId, WRITES_METRIC, period.month.period), workspaceId: input.workspaceId, siteId: null, metric: WRITES_METRIC, period: period.month, limit: limits.writes.month },
    ] : []),
  ];
  const usage = createDataAccess(env.DB).usage;
  await reserveCounters(usage, counters);
}

export async function getApiUsageSummary(input: { workspaceId: string; siteId: string; tokenId?: string | null }): Promise<ApiUsageSummary> {
  const billingStatus = await getBillingStatus(input.workspaceId);
  const limits = planFor(billingStatus);
  const period = windows();
  const enforced = !isSelfHosted();
  const usage = createDataAccess(env.DB).usage;
  return {
    enforced,
    billingStatus,
    calls: {
      minute: await readStatus(usage, workspaceCounterId(input.workspaceId, CALLS_METRIC, period.minute.period), CALLS_METRIC, period.minute, limits.calls.minute),
      day: await readStatus(usage, workspaceCounterId(input.workspaceId, CALLS_METRIC, period.day.period), CALLS_METRIC, period.day, limits.calls.day),
      month: await readStatus(usage, workspaceCounterId(input.workspaceId, CALLS_METRIC, period.month.period), CALLS_METRIC, period.month, limits.calls.month),
    },
    writes: {
      day: await readStatus(usage, workspaceCounterId(input.workspaceId, WRITES_METRIC, period.day.period), WRITES_METRIC, period.day, limits.writes.day),
      month: await readStatus(usage, workspaceCounterId(input.workspaceId, WRITES_METRIC, period.month.period), WRITES_METRIC, period.month, limits.writes.month),
    },
    token: input.tokenId
      ? { minute: await readStatus(usage, tokenCounterId(input.tokenId, CALLS_METRIC, period.minute.period), CALLS_METRIC, period.minute, limits.token.minute) }
      : null,
  };
}

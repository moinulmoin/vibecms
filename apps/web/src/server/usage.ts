import { API_USAGE_LIMITS } from "@vc/config";
import { RateLimitError, type BillingStatus } from "@vc/core";
import { env } from "cloudflare:workers";
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
type UsageCounterRow = { value: number };

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
  if (env.APP_ENV === "production") return null;
  const limit = Number(env.API_USAGE_TEST_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) return null;
  return {
    calls: { minute: limit, day: limit, month: limit },
    writes: { day: limit, month: limit },
    token: { minute: limit },
  };
}

function planFor(): LimitPlan {
  const testPlan = testLimitPlan();
  if (testPlan) return testPlan;
  if (env.APP_ENV === "development" || env.APP_ENV === "test") return API_USAGE_LIMITS.dev;
  return API_USAGE_LIMITS.paid;
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

async function readCounter(id: string) {
  const row = await env.DB.prepare("SELECT value FROM usage_counters WHERE id = ? LIMIT 1").bind(id).first<UsageCounterRow>();
  return row?.value ?? 0;
}

async function readStatus(id: string, metric: string, period: PeriodWindow, limit: number) {
  return status(metric, period, await readCounter(id), limit);
}

function errorFor(limitStatus: ApiUsageStatus) {
  return Object.assign(new RateLimitError(), { usageStatus: limitStatus });
}

async function assertUnderLimit(counterId: string, metric: string, period: PeriodWindow, limit: number) {
  const used = await readCounter(counterId);
  if (used >= limit) throw errorFor(status(metric, period, used, limit));
}

async function incrementCounter(input: UsageCounter) {
  const timestamp = now();
  const result = await env.DB.prepare(
    `INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET value = usage_counters.value + 1, updated_at = excluded.updated_at
     WHERE usage_counters.value + excluded.value <= ?`,
  ).bind(input.id, input.workspaceId, input.siteId, input.period.period, input.metric, timestamp, timestamp, input.limit).run();
  if (result.meta.changes === 0) {
    const used = await readCounter(input.id);
    throw errorFor(status(input.metric, input.period, used, input.limit));
  }
}

async function releaseCounter(input: UsageCounter) {
  await env.DB.prepare(
    "UPDATE usage_counters SET value = MAX(value - 1, 0), updated_at = ? WHERE id = ?",
  ).bind(now(), input.id).run();
}

async function reserveCounters(counters: UsageCounter[]) {
  for (const counter of counters) await assertUnderLimit(counter.id, counter.metric, counter.period, counter.limit);
  const reserved: UsageCounter[] = [];
  try {
    for (const counter of counters) {
      await incrementCounter(counter);
      reserved.push(counter);
    }
  } catch (error) {
    await Promise.all(reserved.map((counter) => releaseCounter(counter)));
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
  const limits = planFor();
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
  await reserveCounters(counters);
}

export async function getApiUsageSummary(input: { workspaceId: string; siteId: string; tokenId?: string | null }): Promise<ApiUsageSummary> {
  const billingStatus = await getBillingStatus(input.workspaceId);
  const limits = planFor();
  const period = windows();
  const enforced = !isSelfHosted();
  return {
    enforced,
    billingStatus,
    calls: {
      minute: await readStatus(workspaceCounterId(input.workspaceId, CALLS_METRIC, period.minute.period), CALLS_METRIC, period.minute, limits.calls.minute),
      day: await readStatus(workspaceCounterId(input.workspaceId, CALLS_METRIC, period.day.period), CALLS_METRIC, period.day, limits.calls.day),
      month: await readStatus(workspaceCounterId(input.workspaceId, CALLS_METRIC, period.month.period), CALLS_METRIC, period.month, limits.calls.month),
    },
    writes: {
      day: await readStatus(workspaceCounterId(input.workspaceId, WRITES_METRIC, period.day.period), WRITES_METRIC, period.day, limits.writes.day),
      month: await readStatus(workspaceCounterId(input.workspaceId, WRITES_METRIC, period.month.period), WRITES_METRIC, period.month, limits.writes.month),
    },
    token: input.tokenId
      ? { minute: await readStatus(tokenCounterId(input.tokenId, CALLS_METRIC, period.minute.period), CALLS_METRIC, period.minute, limits.token.minute) }
      : null,
  };
}

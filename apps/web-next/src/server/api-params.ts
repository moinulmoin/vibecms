import { AppError, RateLimitError } from "@vc/core";
import { env } from "cloudflare:workers";
import { apiRateLimitHeaders } from "./usage";

export function apiError(error: unknown) {
  if (error instanceof AppError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    const safeCode = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "VALIDATION_ERROR",
      "BILLING_REQUIRED",
      "RATE_LIMIT",
    ].includes(error.code)
      ? error.code
      : "INTERNAL_ERROR";
    return Response.json(
      { error: safeCode },
      { status, headers: error instanceof RateLimitError ? apiRateLimitHeaders(error) : undefined },
    );
  }
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

export function postStatusParam(value: string | null) {
  return value === "draft" || value === "published" || value === "archived" ? value : undefined;
}

export function boundedIntegerParam(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function forceQuotaForSmoke(request: Request) {
  return env.APP_ENV !== "production" && request.headers.get("x-vibecms-quota-smoke") === "1";
}
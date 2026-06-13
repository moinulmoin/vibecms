import type { BillingStatus } from "@vc/core";
import { ForbiddenError } from "@vc/core";
import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { env } from "cloudflare:workers";
import type { AppUserContext } from "./onboarding";

type BillingRow = { id: string; workspace_id: string; polar_customer_id: string | null; polar_subscription_id: string | null; status: BillingStatus; current_period_end: number | null };
type SiteWorkspaceRow = { workspace_id: string };
type PolarWebhookEvent = { type: string; data?: Record<string, unknown> };

function now() {
  return Math.floor(Date.now() / 1000);
}

export function isSelfHosted() {
  return env.SELF_HOSTED === "true";
}

function redirect(to: string) {
  return new Response(null, { status: 303, headers: { Location: to } });
}

function redirectWithStatus(to: string, kind: "ok" | "error", code: string) {
  return redirect(`${to}?${kind}=${code}`);
}

function requireOwner(app: AppUserContext) {
  if (app.actor.type !== "human" || app.actor.role !== "owner") throw new ForbiddenError("Owner access required");
}

export async function ensureBillingRow(workspaceId: string, status: BillingStatus = "none") {
  const timestamp = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(`billing_${workspaceId}`, workspaceId, status, null, timestamp, timestamp).run();
}

export async function getBilling(workspaceId: string) {
  return env.DB.prepare(
    "SELECT id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end FROM billing_customers WHERE workspace_id = ? LIMIT 1",
  ).bind(workspaceId).first<BillingRow>();
}

export async function getBillingStatus(workspaceId: string): Promise<BillingStatus> {
  if (isSelfHosted()) return "active";
  const row = await getBilling(workspaceId);
  if (!row) return "none";
  return row.status;
}

export async function getBillingStatusForSite(siteId: string): Promise<BillingStatus> {
  const site = await env.DB.prepare("SELECT workspace_id FROM sites WHERE id = ? LIMIT 1").bind(siteId).first<SiteWorkspaceRow>();
  return site ? getBillingStatus(site.workspace_id) : "none";
}

function polar() {
  if (!env.POLAR_ACCESS_TOKEN) return null;
  return new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: env.POLAR_SERVER === "sandbox" ? "sandbox" : "production" });
}

export async function createCheckoutSession(app: AppUserContext, request?: Request) {
  try {
    requireOwner(app);
  } catch {
    return redirectWithStatus("/app/billing", "error", "owner_required");
  }
  if (isSelfHosted()) return redirect("/app");
  const form = request ? await request.formData().catch(() => null) : null;
  const interval = form?.get("interval") === "yearly" ? "yearly" : "monthly";
  const monthlyProductId = env.POLAR_MONTHLY_PRODUCT_ID ?? env.POLAR_PRODUCT_ID;
  const productId = interval === "yearly" ? env.POLAR_YEARLY_PRODUCT_ID : monthlyProductId;
  if (!productId) return redirectWithStatus("/app/billing", "error", interval === "yearly" ? "yearly_unavailable" : "polar_unconfigured");
  const client = polar();
  if (!client) return redirectWithStatus("/app/billing", "error", "polar_unconfigured");
  try {
    const session = await client.checkouts.create({
      products: [productId],
      successUrl: `${env.APP_URL}/app?ok=billing_success&checkout_id={CHECKOUT_ID}`,
      returnUrl: `${env.APP_URL}/app/billing?error=unknown`,
      externalCustomerId: app.workspaceId,
      customerEmail: app.user.email,
      customerName: app.user.name,
      metadata: { workspaceId: app.workspaceId },
      customerMetadata: { workspaceId: app.workspaceId },
    });
    return redirect(session.url);
  } catch (error) {
    console.error("polar checkout failed", error);
    return redirectWithStatus("/app/billing", "error", "checkout_failed");
  }
}

export async function createPortalSession(app: AppUserContext) {
  try {
    requireOwner(app);
  } catch {
    return redirectWithStatus("/app/settings", "error", "owner_required");
  }
  if (isSelfHosted()) return redirect("/app/settings");
  const billing = await getBilling(app.workspaceId);
  if (!billing?.polar_customer_id && billing?.status === "none") return redirectWithStatus("/app/settings", "error", "billing_required");
  const client = polar();
  if (!client) return redirectWithStatus("/app/settings", "error", "polar_unconfigured");
  try {
    const session = await client.customerSessions.create({ externalCustomerId: app.workspaceId, returnUrl: `${env.APP_URL}/app/settings` });
    return redirect(session.customerPortalUrl);
  } catch {
    return redirectWithStatus("/app/settings", "error", "polar_unconfigured");
  }
}

function subscriptionStatus(value: unknown): BillingStatus {
  if (value === "trialing") return "active";
  if (value === "active" || value === "past_due" || value === "canceled" || value === "unpaid") return value;
  if (value === "incomplete" || value === "incomplete_expired") return "unpaid";
  return "none";
}

function epochSeconds(value: unknown) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  return typeof value === "number" ? value : null;
}

function headerRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => { record[key] = value; });
  return record;
}

function stringField(data: Record<string, unknown>, camelKey: string, snakeKey: string) {
  const camelValue = data[camelKey];
  if (typeof camelValue === "string") return camelValue;
  const snakeValue = data[snakeKey];
  return typeof snakeValue === "string" ? snakeValue : undefined;
}

function workspaceIdFrom(data: Record<string, unknown>) {
  const metadata = data.metadata;
  const rootCustomerMetadata = data.customer_metadata;
  const customerMetadata = typeof data.customer === "object" && data.customer ? (data.customer as Record<string, unknown>).metadata : undefined;
  for (const source of [metadata, rootCustomerMetadata, customerMetadata]) {
    if (typeof source === "object" && source && "workspaceId" in source) return String((source as Record<string, unknown>).workspaceId);
  }
  return stringField(data, "externalCustomerId", "external_customer_id");
}

export async function handlePolarWebhook(request: Request) {
  if (isSelfHosted()) return Response.json({ received: true, ignored: true });
  const payload = await request.text();
  if (!env.POLAR_WEBHOOK_SECRET && env.APP_ENV === "production") return new Response("Missing webhook secret", { status: 500 });
  let event: PolarWebhookEvent;
  try {
    event = env.POLAR_WEBHOOK_SECRET
      ? validateEvent(payload, headerRecord(request.headers), env.POLAR_WEBHOOK_SECRET) as PolarWebhookEvent
      : JSON.parse(payload) as PolarWebhookEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  const data = event.data;
  if (!data) return Response.json({ received: true });
  const workspaceId = workspaceIdFrom(data);
  if (!workspaceId) return Response.json({ received: true });
  const timestamp = now();
  const status = event.type.startsWith("subscription.") ? subscriptionStatus(data.status) : event.type === "checkout.updated" && data.status === "succeeded" ? "active" : undefined;
  if (!status) return Response.json({ received: true });
  const subscriptionId = stringField(data, "subscriptionId", "subscription_id") ?? (typeof data.id === "string" && event.type.startsWith("subscription.") ? data.id : null);
  await env.DB.prepare(
    `INSERT INTO billing_customers (id, workspace_id, polar_customer_id, polar_subscription_id, status, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET polar_customer_id = excluded.polar_customer_id, polar_subscription_id = COALESCE(excluded.polar_subscription_id, billing_customers.polar_subscription_id), status = excluded.status, current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`,
  ).bind(
    `billing_${workspaceId}`,
    workspaceId,
    stringField(data, "customerId", "customer_id") ?? null,
    subscriptionId,
    status,
    epochSeconds(data.currentPeriodEnd ?? data.current_period_end),
    timestamp,
    timestamp,
  ).run();
  return Response.json({ received: true });
}

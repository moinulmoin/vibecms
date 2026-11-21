import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BillingStatus } from "@vc/core";
import { createDbClient } from "../client";
import {
  billingCustomers,
  polarDuplicateSubscriptions,
  sites,
  type BillingCustomerRow,
  type PolarDuplicateSubscriptionRow,
} from "../schema";

// Input for the Polar webhook upsert; signature verification + Polar SDK stay in the app layer.
export type UpsertBillingInput = {
  workspaceId: string;
  polarCustomerId: string | null;
  polarSubscriptionId: string | null;
  status: BillingStatus;
  currentPeriodEnd: number | null;
};

export interface BillingRepository {
  // INSERT OR IGNORE a billing_customers row; idempotent per workspace.
  ensureBillingRow(workspaceId: string, status?: BillingStatus): Promise<void>;
  // Full billing_customers row for a workspace, or undefined if absent.
  getBillingRecord(workspaceId: string): Promise<BillingCustomerRow | undefined>;
  // Resolve the owning workspace for a site, or undefined when no site exists.
  getWorkspaceIdForSite(siteId: string): Promise<string | undefined>;
  // Polar webhook upsert: keep the existing subscription id when the incoming one is null.
  upsertFromWebhook(input: UpsertBillingInput): Promise<void>;
  // A recorded second subscription for an already-paid blog, by its Polar subscription id.
  getDuplicateSubscription(id: string): Promise<PolarDuplicateSubscriptionRow | undefined>;
  // The paid duplicates whose refund notice is still owed, oldest first.
  listUnnotifiedDuplicateSubscriptions(limit?: number): Promise<PolarDuplicateSubscriptionRow[]>;
  // Marks the refund notice as accepted, so it is not sent again.
  markDuplicateSubscriptionNotified(id: string, now: number): Promise<void>;
  // Past-due episodes in their grace whose latest due email is not sent yet, oldest first; never a sponsored or ownerless one.
  listDuePaymentReminders(input: { nowMs: number; graceMs: number; days: readonly number[]; limit: number }): Promise<DuePaymentReminder[]>;
  // Claims one email right before it is sent, only while its episode is still past due, inside its grace, unsponsored,
  // the day is still the latest one due, the owner still has this email, and no email of this day or later was claimed.
  claimPaymentReminder(input: {
    workspaceId: string;
    pastDueSince: number;
    day: number;
    ownerEmail: string;
    nowMs: number;
    graceMs: number;
    days: readonly number[];
  }): Promise<boolean>;
}

export type DuePaymentReminder = {
  workspaceId: string;
  /** Epoch milliseconds of the failed renewal that opened the episode. */
  pastDueSince: number;
  /** The latest reminder day that is due now. */
  day: number;
  ownerEmail: string;
  siteId: string | null;
  siteName: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Day N of the grace begins N-1 days after the failed renewal; the latest begun day is due.
function dueDaySql(days: readonly number[]): string {
  const latestFirst = [...days].sort((left, right) => right - left);
  return `CASE ${latestFirst.map(() => "WHEN ? - b.past_due_since >= ? THEN ?").join(" ")} END`;
}

function dueDayBinds(nowMs: number, days: readonly number[]): number[] {
  return [...days].sort((left, right) => right - left).flatMap((day) => [nowMs, (day - 1) * DAY_MS, day]);
}

// A past-due episode inside its grace whose blog AutoSEOPilot does not sponsor
// (an active sponsorship as in evaluateEffectiveHostedEntitlement keeps paid features on).
const dueEpisodeSql = `b.status = 'past_due' AND b.past_due_since IS NOT NULL
  AND b.past_due_since <= ? AND b.past_due_since > ? - ?
  AND NOT EXISTS (
    SELECT 1 FROM autoseopilot_managed_sites ms
     WHERE ms.workspace_id = b.workspace_id AND ms.entitlement_status = 'active'
       AND (ms.entitlement_expires_at IS NULL OR ms.entitlement_expires_at > ?)
  )`;

function dueEpisodeBinds(nowMs: number, graceMs: number): number[] {
  return [nowMs, nowMs, graceMs, nowMs / 1000];
}

// The workspace's first owner, the one who gets billing email.
const ownerEmailSql = `(SELECT u.email FROM memberships m JOIN user u ON u.id = m.user_id
  WHERE m.workspace_id = b.workspace_id AND m.role = 'owner'
  ORDER BY m.created_at ASC, m.id ASC LIMIT 1)`;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createBillingRepository(db: D1Database): BillingRepository {
  const client = createDbClient(db);
  return {
    async ensureBillingRow(workspaceId, status = "none") {
      const ts = nowSeconds();
      await client
        .insert(billingCustomers)
        .values({
          id: `billing_${workspaceId}`,
          workspaceId,
          status,
          currentPeriodEnd: null,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoNothing()
        .run();
    },

    async getBillingRecord(workspaceId) {
      const rows = await client
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.workspaceId, workspaceId))
        .limit(1);
      return rows[0];
    },

    async getWorkspaceIdForSite(siteId) {
      const rows = await client
        .select({ workspaceId: sites.workspaceId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0]?.workspaceId;
    },

    async upsertFromWebhook(input) {
      const ts = nowSeconds();
      await client
        .insert(billingCustomers)
        .values({
          id: `billing_${input.workspaceId}`,
          workspaceId: input.workspaceId,
          polarCustomerId: input.polarCustomerId,
          polarSubscriptionId: input.polarSubscriptionId,
          status: input.status,
          currentPeriodEnd: input.currentPeriodEnd,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: billingCustomers.workspaceId,
          set: {
            polarCustomerId: sql`excluded.polar_customer_id`,
            polarSubscriptionId: sql`coalesce(excluded.polar_subscription_id, ${billingCustomers.polarSubscriptionId})`,
            status: sql`excluded.status`,
            currentPeriodEnd: sql`excluded.current_period_end`,
            // No event timestamp here, so this path never starts a grace clock;
            // leaving past_due clears it so a stale start is never reused.
            pastDueSince: sql`CASE WHEN excluded.status = 'past_due' THEN ${billingCustomers.pastDueSince} ELSE NULL END`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();
    },

    async getDuplicateSubscription(id) {
      const rows = await client
        .select()
        .from(polarDuplicateSubscriptions)
        .where(eq(polarDuplicateSubscriptions.id, id))
        .limit(1);
      return rows[0];
    },

    async listUnnotifiedDuplicateSubscriptions(limit = 50) {
      return client
        .select()
        .from(polarDuplicateSubscriptions)
        .where(and(eq(polarDuplicateSubscriptions.paymentEvidence, 1), isNull(polarDuplicateSubscriptions.notifiedAt)))
        .orderBy(asc(polarDuplicateSubscriptions.createdAt))
        .limit(limit);
    },

    async markDuplicateSubscriptionNotified(id, now) {
      await client
        .update(polarDuplicateSubscriptions)
        .set({ notifiedAt: now, updatedAt: now })
        .where(and(eq(polarDuplicateSubscriptions.id, id), isNull(polarDuplicateSubscriptions.notifiedAt)))
        .run();
    },

    async listDuePaymentReminders({ nowMs, graceMs, days, limit }) {
      const { results } = await db
        .prepare(
          `SELECT c.* FROM (
             SELECT b.workspace_id, b.past_due_since, ${dueDaySql(days)} AS day, ${ownerEmailSql} AS owner_email,
                    (SELECT s.id FROM sites s WHERE s.workspace_id = b.workspace_id
                      ORDER BY s.created_at ASC, s.id ASC LIMIT 1) AS site_id,
                    (SELECT s.name FROM sites s WHERE s.workspace_id = b.workspace_id
                      ORDER BY s.created_at ASC, s.id ASC LIMIT 1) AS site_name
               FROM billing_customers b
              WHERE ${dueEpisodeSql}
           ) c
           WHERE c.owner_email IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM billing_payment_reminders r
                WHERE r.workspace_id = c.workspace_id AND r.past_due_since = c.past_due_since AND r.day >= c.day
             )
           ORDER BY c.past_due_since ASC
           LIMIT ?`,
        )
        .bind(...dueDayBinds(nowMs, days), ...dueEpisodeBinds(nowMs, graceMs), limit)
        .all<{
          workspace_id: string;
          past_due_since: number;
          day: number;
          owner_email: string;
          site_id: string | null;
          site_name: string | null;
        }>();
      return results.map((row) => ({
        workspaceId: row.workspace_id,
        pastDueSince: row.past_due_since,
        day: row.day,
        ownerEmail: row.owner_email,
        siteId: row.site_id,
        siteName: row.site_name,
      }));
    },

    async claimPaymentReminder({ workspaceId, pastDueSince, day, ownerEmail, nowMs, graceMs, days }) {
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO billing_payment_reminders (workspace_id, past_due_since, day, sent_at)
           SELECT ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM billing_customers b
               WHERE b.workspace_id = ? AND b.past_due_since = ? AND ${dueEpisodeSql}
                 AND ${dueDaySql(days)} = ? AND ${ownerEmailSql} = ?
            )
              AND NOT EXISTS (
                SELECT 1 FROM billing_payment_reminders r
                 WHERE r.workspace_id = ? AND r.past_due_since = ? AND r.day >= ?
              )`,
        )
        .bind(
          workspaceId,
          pastDueSince,
          day,
          Math.floor(nowMs / 1000),
          workspaceId,
          pastDueSince,
          ...dueEpisodeBinds(nowMs, graceMs),
          ...dueDayBinds(nowMs, days),
          day,
          ownerEmail,
          workspaceId,
          pastDueSince,
          day,
        )
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
  };
}

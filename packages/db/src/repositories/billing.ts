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
  // Past-due episodes still inside their grace, with the owner's email, the blog's name and the days already sent.
  listPastDueForReminders(nowMs: number, graceMs: number, limit: number): Promise<PastDueReminderCandidate[]>;
  // Claims one email of a still-current episode before it is sent; false when it was already claimed or the episode ended.
  claimPaymentReminder(workspaceId: string, pastDueSince: number, day: number, now: number): Promise<boolean>;
  // Gives a claimed email back after a failed send, so the next sweep retries it.
  releasePaymentReminder(workspaceId: string, pastDueSince: number, day: number): Promise<void>;
}

export type PastDueReminderCandidate = {
  workspaceId: string;
  /** Epoch milliseconds of the failed renewal that opened the episode. */
  pastDueSince: number;
  ownerEmail: string | null;
  siteName: string | null;
  sentDays: number[];
};

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

    async listPastDueForReminders(nowMs, graceMs, limit) {
      const { results } = await db
        .prepare(
          `SELECT b.workspace_id, b.past_due_since,
                  (SELECT u.email FROM memberships m JOIN user u ON u.id = m.user_id
                    WHERE m.workspace_id = b.workspace_id AND m.role = 'owner'
                    ORDER BY m.created_at ASC LIMIT 1) AS owner_email,
                  (SELECT s.name FROM sites s WHERE s.workspace_id = b.workspace_id
                    ORDER BY s.created_at ASC LIMIT 1) AS site_name,
                  (SELECT group_concat(r.day) FROM billing_payment_reminders r
                    WHERE r.workspace_id = b.workspace_id AND r.past_due_since = b.past_due_since) AS sent_days
             FROM billing_customers b
            WHERE b.status = 'past_due' AND b.past_due_since IS NOT NULL
              AND b.past_due_since + ? > ?
            ORDER BY b.past_due_since ASC
            LIMIT ?`,
        )
        .bind(graceMs, nowMs, limit)
        .all<{
          workspace_id: string;
          past_due_since: number;
          owner_email: string | null;
          site_name: string | null;
          sent_days: string | null;
        }>();
      return results.map((row) => ({
        workspaceId: row.workspace_id,
        pastDueSince: row.past_due_since,
        ownerEmail: row.owner_email,
        siteName: row.site_name,
        sentDays: row.sent_days ? row.sent_days.split(",").map(Number) : [],
      }));
    },

    async claimPaymentReminder(workspaceId, pastDueSince, day, now) {
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO billing_payment_reminders (workspace_id, past_due_since, day, sent_at)
           SELECT ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM billing_customers
               WHERE workspace_id = ? AND status = 'past_due' AND past_due_since = ?
            )`,
        )
        .bind(workspaceId, pastDueSince, day, now, workspaceId, pastDueSince)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async releasePaymentReminder(workspaceId, pastDueSince, day) {
      await db
        .prepare("DELETE FROM billing_payment_reminders WHERE workspace_id = ? AND past_due_since = ? AND day = ?")
        .bind(workspaceId, pastDueSince, day)
        .run();
    },
  };
}

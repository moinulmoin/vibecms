import { eq, sql } from "drizzle-orm";
import type { BillingStatus } from "@vc/core";
import { createDbClient } from "../client";
import { billingCustomers, sites, type BillingCustomerRow } from "../schema";

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
  // True when the workspace already has an active subscription (blocks new checkout).
  isActiveSubscription(workspaceId: string): Promise<boolean>;
  // Resolve the owning workspace for a site, or undefined when no site exists.
  getWorkspaceIdForSite(siteId: string): Promise<string | undefined>;
  // Polar webhook upsert: keep the existing subscription id when the incoming one is null.
  upsertFromWebhook(input: UpsertBillingInput): Promise<void>;
}

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

    async isActiveSubscription(workspaceId) {
      const rows = await client
        .select({ status: billingCustomers.status })
        .from(billingCustomers)
        .where(eq(billingCustomers.workspaceId, workspaceId))
        .limit(1);
      return rows[0]?.status === "active";
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
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .run();
    },
  };
}

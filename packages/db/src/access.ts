import type { DomainRepository, PostRepository } from "@vc/core";
import { createDbClient, type DbClient } from "./client";
import { createActivityRepository, type ActivityRepository } from "./repositories/activity";
import { createApiKeysRepository, type ApiKeysRepository } from "./repositories/api-keys";
import { createD1AssetRepository, type AssetDbRepository } from "./repositories/assets";
import { createD1DomainRepository } from "./repositories/domains";
import { createD1PostRepository } from "./repositories/posts";
import { createD1SubscriberRepository, type AddPendingInput } from "./repositories/subscribers";
import { createSitesRepository, type SitesRepository } from "./repositories/sites";
import { createBillingRepository, type BillingRepository } from "./repositories/billing";
import { createUsageRepository, type UsageRepository } from "./repositories/usage";
import { createRateLimitsRepository, type RateLimitsRepository } from "./repositories/rate-limits";
import { createPublicBlogReadModel, type PublicBlogReadModel } from "./read-models/public-blog";
import { createDashboardReadModel, type DashboardReadModel } from "./read-models/dashboard";
import { createExportReadModel, type ExportReadModel } from "./read-models/exports";

// Shape returned by createD1SubscriberRepository (which has no named type).
export interface SubscriberRepository {
  addPending(input: AddPendingInput): Promise<{ created: boolean }>;
}

export interface DataAccess {
  client: DbClient;
  d1: D1Database;
  posts: PostRepository;
  assets: AssetDbRepository;
  domains: DomainRepository;
  subscribers: SubscriberRepository;
  activity: ActivityRepository;
  sites: SitesRepository;
  billing: BillingRepository;
  usage: UsageRepository;
  rateLimits: RateLimitsRepository;
  apiKeys: ApiKeysRepository;
  publicBlog: PublicBlogReadModel;
  dashboard: DashboardReadModel;
  exports: ExportReadModel;
}

// One aggregated data-access entry point: Drizzle client + raw D1 + repositories.
export function createDataAccess(db: D1Database): DataAccess {
  const client = createDbClient(db);
  return {
    client,
    d1: db,
    posts: createD1PostRepository(db),
    assets: createD1AssetRepository(db),
    domains: createD1DomainRepository(db),
    subscribers: createD1SubscriberRepository(db),
    activity: createActivityRepository(db),
    apiKeys: createApiKeysRepository(db),
    sites: createSitesRepository(db),
    billing: createBillingRepository(db),
    usage: createUsageRepository(db),
    rateLimits: createRateLimitsRepository(db),
    publicBlog: createPublicBlogReadModel(db),
    dashboard: createDashboardReadModel(db),
    exports: createExportReadModel(db),
  };
}

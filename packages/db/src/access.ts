import type { AssetRepository, DomainRepository, PostRepository } from "@vc/core";
import { createDbClient, type DbClient } from "./client";
import { createActivityRepository, type ActivityRepository } from "./repositories/activity";
import { createD1AssetRepository } from "./repositories/assets";
import { createD1DomainRepository } from "./repositories/domains";
import { createD1PostRepository } from "./repositories/posts";
import { createD1SubscriberRepository, type AddPendingInput } from "./repositories/subscribers";

// Shape returned by createD1SubscriberRepository (which has no named type).
export interface SubscriberRepository {
  addPending(input: AddPendingInput): Promise<{ created: boolean }>;
}

export interface DataAccess {
  client: DbClient;
  d1: D1Database;
  posts: PostRepository;
  assets: AssetRepository;
  domains: DomainRepository;
  subscribers: SubscriberRepository;
  activity: ActivityRepository;
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
  };
}

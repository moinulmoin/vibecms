import { drizzle } from "drizzle-orm/d1";
import type { AssetRepository, DomainRepository, PostRepository } from "@vc/core";
import * as schema from "./schema";
import { createD1AssetRepository } from "./repositories/assets";
import { createD1DomainRepository } from "./repositories/domains";
import { createD1PostRepository } from "./repositories/posts";
import { createD1SubscriberRepository, type AddPendingInput } from "./repositories/subscribers";

export function createDbClient(db: D1Database) {
  return drizzle(db, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

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
  };
}

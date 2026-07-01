import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDbClient(db: D1Database) {
  return drizzle(db, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;


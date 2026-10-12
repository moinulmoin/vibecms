import { and, eq } from "drizzle-orm";
import { createDbClient } from "../client";
import { postSeoReviews } from "../schema";

// Cached AI SEO review for one immutable post version. resultJson is the raw
// JSON string returned by the AI binding — the API layer owns parsing and
// validation, so this package keeps no content/zod dependency.
export interface SeoReviewCacheEntry {
  postId: string;
  versionNumber: number;
  model: string;
  resultJson: string;
  neuronsEstimate: number | null;
  createdAt: number;
}

export interface StoreSeoReviewInput {
  siteId: string;
  postId: string;
  versionNumber: number;
  model: string;
  resultJson: string;
  neuronsEstimate?: number | null;
  createdAt: number;
}

export interface SeoReviewsRepository {
  /** Cached review for (post, version, model), or null. Always site-scoped. */
  get(siteId: string, postId: string, versionNumber: number, model: string): Promise<SeoReviewCacheEntry | null>;
  /**
   * Store a review; upserts on the unique (post, version, model) key so a
   * retried call replaces the earlier result.
   */
  put(input: StoreSeoReviewInput): Promise<void>;
}

export function createSeoReviewsRepository(db: D1Database): SeoReviewsRepository {
  const client = createDbClient(db);
  return {
    async get(siteId, postId, versionNumber, model) {
      const [row] = await client
        .select()
        .from(postSeoReviews)
        .where(and(
          eq(postSeoReviews.siteId, siteId),
          eq(postSeoReviews.postId, postId),
          eq(postSeoReviews.versionNumber, versionNumber),
          eq(postSeoReviews.model, model),
        ))
        .limit(1);
      if (!row) return null;
      return {
        postId: row.postId,
        versionNumber: row.versionNumber,
        model: row.model,
        resultJson: row.resultJson,
        neuronsEstimate: row.neuronsEstimate,
        createdAt: row.createdAt,
      };
    },

    async put(input) {
      await client
        .insert(postSeoReviews)
        .values({
          siteId: input.siteId,
          postId: input.postId,
          versionNumber: input.versionNumber,
          model: input.model,
          resultJson: input.resultJson,
          neuronsEstimate: input.neuronsEstimate ?? null,
          createdAt: input.createdAt,
        })
        .onConflictDoUpdate({
          target: [postSeoReviews.postId, postSeoReviews.versionNumber, postSeoReviews.model],
          set: {
            siteId: input.siteId,
            resultJson: input.resultJson,
            neuronsEstimate: input.neuronsEstimate ?? null,
            createdAt: input.createdAt,
          },
        });
    },

  };
}

import { desc, eq } from "drizzle-orm";
import { createDbClient } from "../client";
import { posts, sites } from "../schema";

// Owner-only full-blog export site projection: SELECT id,name,slug,description,default_seo_title,default_seo_description.
export interface ExportSite {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
}

// Full post projection for export (all statuses incl. drafts/archived). tagsJson is returned raw; the app parses it for the JSON payload. Ordered by updated_at DESC, id DESC upstream.
export interface ExportPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  status: "draft" | "published" | "archived";
  publishedAt: number | null;
  tagsJson: string;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  coverAssetId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExportReadModel {
  getExportSite(siteId: string): Promise<ExportSite | null>;
  listAllPostsForExport(siteId: string): Promise<ExportPost[]>;
}

// Export read model extracted from apps/web/src/server/export.ts. Takes a D1Database and builds its own Drizzle client; no env import. The app keeps owner authorization, JSON payload shaping, and the Response.
export function createExportReadModel(db: D1Database): ExportReadModel {
  const client = createDbClient(db);

  return {
    async getExportSite(siteId) {
      const rows = await client
        .select({
          id: sites.id,
          name: sites.name,
          slug: sites.slug,
          description: sites.description,
          defaultSeoTitle: sites.defaultSeoTitle,
          defaultSeoDescription: sites.defaultSeoDescription,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0] ?? null;
    },

    async listAllPostsForExport(siteId) {
      return client
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          excerpt: posts.excerpt,
          contentMarkdown: posts.contentMarkdown,
          status: posts.status,
          publishedAt: posts.publishedAt,
          tagsJson: posts.tagsJson,
          seoTitle: posts.seoTitle,
          seoDescription: posts.seoDescription,
          canonicalUrl: posts.canonicalUrl,
          coverAssetId: posts.coverAssetId,
          createdAt: posts.createdAt,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(eq(posts.siteId, siteId))
        .orderBy(desc(posts.updatedAt), desc(posts.id));
    },
  };
}

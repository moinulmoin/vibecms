import { desc, eq } from "drizzle-orm";
import { createDbClient } from "../client";
import { assets, postVersions, posts, sites } from "../schema";

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
  presentationJson: string | null;
  publishedVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExportVersion {
  id: string;
  postId: string;
  versionNumber: number;
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverAssetId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  tagsJson: string;
  presentationJson: string | null;
  createdAt: number;
}

export interface ExportAsset {
  id: string;
  filename: string;
  mimeType: string;
  altText: string | null;
}

export interface ExportReadModel {
  getExportSite(siteId: string): Promise<ExportSite | null>;
  listAllPostsForExport(siteId: string): Promise<ExportPost[]>;
  listVersionsForExport(siteId: string): Promise<ExportVersion[]>;
  listAssetsForExport(siteId: string): Promise<ExportAsset[]>;
}

// DB-only export read model. The API layer owns authorization, JSON payload shaping, and the Response.
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
      const rows = await client
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
          presentationJson: posts.presentationJson,
          publishedVersionId: posts.publishedVersionId,
          createdAt: posts.createdAt,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(eq(posts.siteId, siteId))
        .orderBy(desc(posts.updatedAt), desc(posts.id));
      return rows;
    },
    async listVersionsForExport(siteId) {
      return client.select({
        id: postVersions.id,
        postId: postVersions.postId,
        versionNumber: postVersions.versionNumber,
        title: postVersions.title,
        slug: postVersions.slug,
        excerpt: postVersions.excerpt,
        contentMarkdown: postVersions.contentMarkdown,
        coverAssetId: postVersions.coverAssetId,
        seoTitle: postVersions.seoTitle,
        seoDescription: postVersions.seoDescription,
        canonicalUrl: postVersions.canonicalUrl,
        tagsJson: postVersions.tagsJson,
        presentationJson: postVersions.presentationJson,
        createdAt: postVersions.createdAt,
      }).from(postVersions).where(eq(postVersions.siteId, siteId));
    },
    async listAssetsForExport(siteId) {
      return client.select({
        id: assets.id,
        filename: assets.filename,
        mimeType: assets.mimeType,
        altText: assets.altText,
      }).from(assets).where(eq(assets.siteId, siteId));
    },
  };
}

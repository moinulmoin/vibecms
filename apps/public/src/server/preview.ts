import { createD1PostRepository, resolvePreviewToken } from '@vc/db';
import { resolvePublicByline } from '../lib/byline';
import { buildPublicSidebar } from './public-blog';
import { listPublishedPostSummaries, resolveSite } from './public-blog-data';
import type { PublicPostLoaderData } from './public-blog';
import type { PublicRuntimeEnv } from '../env';

export const previewResponseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export function previewNotFound(): Response {
  return new Response('Not found', { status: 404, headers: previewResponseHeaders });
}

export async function loadPrivatePreview(db: D1Database, request: Request, token: string, env: PublicRuntimeEnv): Promise<{
  data: PublicPostLoaderData;
  versionNumber: number;
} | null> {
  const site = await resolveSite(request, db, env);
  if (!site) return null;
  const link = await resolvePreviewToken(db, site.id, token);
  if (!link) return null;
  const repo = createD1PostRepository(db);
  const post = await repo.getPost(site.id, link.postId);
  // Keep the token row: restoring an archived post makes its private link work again.
  if (!post || post.status === 'archived') return null;
  const version = await repo.getPostVersion(site.id, post.id, post.currentVersionNumber);
  if (!version) return null;
  const cover = version.coverAssetId
    ? await db.prepare('SELECT mime_type AS mimeType, width, height, alt_text AS altText FROM assets WHERE site_id = ? AND id = ?')
      .bind(site.id, version.coverAssetId).first<{ mimeType: string; width: number | null; height: number | null; altText: string | null }>()
    : null;
  const detail = {
    id: post.id,
    title: version.title,
    slug: version.slug,
    excerpt: version.excerpt,
    content_markdown: version.contentMarkdown,
    cover_asset_id: version.coverAssetId,
    published_at: post.publishedAt,
    updated_at: post.updatedAt,
    seo_title: version.seoTitle,
    seo_description: version.seoDescription,
    canonical_url: version.canonicalUrl,
    cover_asset_mime_type: cover?.mimeType ?? null,
    cover_asset_width: cover?.width ?? null,
    cover_asset_height: cover?.height ?? null,
    cover_asset_alt_text: cover?.altText ?? null,
    tags_json: JSON.stringify(version.tags),
    presentation_json: version.presentation ? JSON.stringify(version.presentation) : null,
    presentation: version.presentation,
    published_by_agent: version.actorType === 'agent' || version.actorType === 'api_key',
  };
  const summaries = await listPublishedPostSummaries(db, site.id).catch(() => []);
  return {
    versionNumber: version.versionNumber,
    data: {
      site,
      post: detail,
      sidebar: buildPublicSidebar(summaries, post.id),
      basePath: '',
      canonicalUrl: `/preview/${token}`,
      origin: new URL(request.url).origin,
      indexable: false,
      cacheTags: [],
      byline: resolvePublicByline(site, detail),
    },
  };
}

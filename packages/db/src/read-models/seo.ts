/**
 * SEO read model for the post seo_check operation: answers "does this slug
 * resolve to a live post?" and supplies every other live post's effective
 * title/description so the deterministic checker in packages/content can
 * flag broken internal links and duplicate SEO fields.
 *
 * "Live" mirrors the public read model's publishedWhere: status 'published',
 * published_at not null and not in the future, and a pinned published_version.
 * All comparisons read the pinned post_versions row, never the mutable posts
 * tip, so drafts-in-progress never leak into the checks.
 */
import { normalizeRedirectPath } from "@vc/core";


// Each candidate is bound twice (live slug and redirect), plus four scope/time
// parameters. Forty candidates keep each query below D1's 100-bind limit.
const SLUG_CANDIDATE_CHUNK = 40;

export interface SeoReadModel {
  /**
   * Of the candidate slugs, return those that resolve to a live post on this
   * site — either as the pinned live slug or as a live redirect (renamed
   * posts keep their old slug in post_slug_redirects). Candidate lists are
   * deduplicated and chunked, so posts with many links stay exact.
   */
  getPublishedSlugs(siteId: string, candidates: string[]): Promise<string[]>;
  /**
   * Effective SEO title/description of every other live post on this site,
   * capped at {@link SEO_FIELD_CANDIDATE_LIMIT} rows in deterministic order.
   * Title is the live version's seo_title falling back to title; description
   * is its effective description (seo_description, then excerpt/fallback).
   * Comparison happens in the caller: SQLite lower() leaves non-ASCII
   * characters unchanged, so in-SQL equality misses Unicode duplicates.
   */
  listPublishedSeoFields(
    siteId: string,
    excludePostId: string | null,
  ): Promise<{ title: string; description: string | null }[]>;
}

// Same live-post predicate as the public read model's publishedWhere:
// published, not scheduled into the future, pinned to a version row.
const livePostWhere = `p.status = 'published'
  AND p.published_at IS NOT NULL
  AND p.published_version_id IS NOT NULL
  AND p.published_at <= ?`;

// Effective description per the public rendering path: seo_description, then
// the excerpt fallbacks used by the summary projection (nullif '' = pending).
const effectiveDescription = `coalesce(nullif(trim(v.seo_description), ''),
  nullif(trim(v.excerpt), ''),
  nullif(v.fallback_excerpt, ''))`;


// Sites with more published posts than this keep the newest-first page: the
// bounded window keeps the duplicate scan predictable for D1 while covering
// every realistic blog. Deterministic order so results are stable.
const SEO_FIELD_CANDIDATE_LIMIT = 500;
export function createSeoReadModel(db: D1Database): SeoReadModel {
  return {
    async getPublishedSlugs(siteId, candidates) {
      const unique = [...new Set(candidates)];
      const now = Math.floor(Date.now() / 1000);
      const resolved: string[] = [];
      for (let i = 0; i < unique.length; i += SLUG_CANDIDATE_CHUNK) {
        const chunk = unique.slice(i, i + SLUG_CANDIDATE_CHUNK);
        if (chunk.length === 0) break;
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = await db
          .prepare(
            `SELECT DISTINCT slug FROM (
               SELECT live.slug AS slug
                 FROM posts AS p
                 JOIN post_versions AS live
                   ON live.id = p.published_version_id AND live.post_id = p.id
                WHERE p.site_id = ? AND live.slug IN (${placeholders}) AND ${livePostWhere}
               UNION ALL
               SELECT redirect.from_slug AS slug
                 FROM post_slug_redirects AS redirect
                 JOIN posts AS p ON p.id = redirect.post_id AND p.site_id = redirect.site_id
                 JOIN post_versions AS live
                   ON live.id = p.published_version_id AND live.post_id = p.id
                WHERE redirect.site_id = ? AND redirect.from_slug IN (${placeholders})
                  AND live.slug <> redirect.from_slug AND ${livePostWhere}
             )`,
          )
          .bind(siteId, ...chunk, now, siteId, ...chunk, now)
          .all<{ slug: string }>();
        for (const row of rows.results ?? []) resolved.push(row.slug);
        const paths = chunk.map((candidate) => candidate.startsWith("/") ? normalizeRedirectPath(candidate) : null);
        const normalized = paths.filter((path): path is string => path !== null);
        if (normalized.length) {
          const matches = await db.prepare(`SELECT from_path AS path FROM site_redirects WHERE site_id = ? AND from_path IN (${normalized.map(() => "?").join(", ")})`)
            .bind(siteId, ...normalized).all<{ path: string }>();
          const found = new Set((matches.results ?? []).map((row) => row.path));
          chunk.forEach((candidate, index) => {
            const path = paths[index];
            if (path && found.has(path)) resolved.push(candidate);
          });
        }
      }
      return resolved;
    },

    async listPublishedSeoFields(siteId, excludePostId) {
      const effectiveTitle = `coalesce(nullif(trim(v.seo_title), ''), v.title)`;
      const rows = await db
        .prepare(
          `SELECT ${effectiveTitle} AS title, ${effectiveDescription} AS description
           FROM posts AS p
           JOIN post_versions AS v
             ON v.id = p.published_version_id AND v.post_id = p.id
           WHERE p.site_id = ? AND ${livePostWhere}
             AND (? IS NULL OR p.id <> ?)
           ORDER BY p.published_at DESC, p.id
           LIMIT ?`,
        )
        .bind(
          siteId,
          Math.floor(Date.now() / 1000),
          excludePostId,
          excludePostId,
          SEO_FIELD_CANDIDATE_LIMIT,
        )
        .all<{ title: string; description: string | null }>();
      return rows.results ?? [];
    },
  };
}

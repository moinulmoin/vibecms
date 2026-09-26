import { renderRichContent, type CodeHighlighter } from "@vc/content";
import { createCodeHighlighter } from "@vc/content/highlight";
import {
  PresentedPostArticle,
  articleHasToc,
  siteThemeRootAttributes,
} from "@vc/content/presented-post";
import { PublicPageChrome } from "@vc/content/public-chrome";
import { PublicPostList } from "@vc/content/public-post-list";
import { resolvePresetId, resolvePresentation, resolveThemeFont, THEME_PRESETS } from "@vc/config";
import type { SidebarData } from "@vc/content/public-chrome";
import type { ArticleAuthor } from "@vc/content/presented-post";
import type {
  PublicIndexLoaderData,
  PublicListingContext,
  PublicPostLoaderData,
} from "../server/public-blog";
import { readingTimeMinutes } from "../lib/reading-time";
import { shouldShowUpdatedDate } from "../lib/seo-meta";
import {
  buildResponsiveMediaUrls,
  resolveResponsiveMediaSource,
} from "../lib/media-assets";
import styles from "./public-blog.module.css";

const DEFAULT_LISTING: PublicListingContext = { kind: "index" };
export const PUBLIC_INDEX_PAGE_SIZE = 20;
let highlighter: CodeHighlighter | null = null;
/** Built on the first post render, not at Worker startup (index pages never need it). */
function codeHighlighter(): CodeHighlighter {
  highlighter ??= createCodeHighlighter();
  return highlighter;
}

function publicIndexHref(basePath: string) {
  return basePath || "/";
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

function siteTheme(site: PublicIndexLoaderData["site"]) {
  return {
    accent: site.theme_accent,
    font: site.theme_font,
    mode: site.theme_mode,
    radius: site.theme_radius,
    width: site.theme_width,
  };
}

/** <html> theme attributes + the font pairing to preload, for Base.astro. */
export function siteDocumentProps(site: PublicIndexLoaderData["site"]) {
  const presetId = resolvePresetId(site.theme);
  return {
    themeAttrs: siteThemeRootAttributes(presetId, siteTheme(site)),
    fontId: resolveThemeFont(site.theme_font, presetId),
  };
}

function templateOf(site: PublicIndexLoaderData["site"]) {
  return THEME_PRESETS[resolvePresetId(site.theme)].template;
}

function sidebarData(basePath: string, source: PublicIndexLoaderData["sidebar"] | null | undefined): SidebarData | null {
  if (!source) return null;
  return {
    recent: source.recent.map((post) => ({ title: post.title, href: `${basePath}/${post.slug}` })),
    tags: source.tags.map((tag) => ({ name: tag.name, count: tag.count, href: `${basePath}/tag/${encodeURIComponent(tag.name)}` })),
  };
}

/** The listing page actually shown for a raw `?page=` value (clamped to the last page). */
export function resolvePublicPage(raw: string | null | undefined, totalPosts: number): number {
  const parsed = /^\d+$/.test(raw ?? "") ? Number(raw) : 1;
  const pageCount = Math.max(1, Math.ceil(totalPosts / PUBLIC_INDEX_PAGE_SIZE));
  return Math.min(Math.max(1, parsed), pageCount);
}

export function requestedPublicPage(raw: string | null | undefined): number {
  const page = /^\d+$/.test(raw ?? "") ? Number(raw) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Canonical path for a listing page: page 1 is the bare path. */
export function publicPageCanonicalPath(basePath: string, page: number): string {
  return pageHref(basePath, page);
}

function pageHref(base: string, page: number, query?: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Index-page chrome with the footer subscribe block (used by listings and tests). */
export function PublicShell({
  site,
  basePath,
  homeHeading = false,
  children,
}: {
  site: PublicIndexLoaderData["site"];
  basePath: string;
  indexable?: boolean;
  homeHeading?: boolean;
  children: React.ReactNode;
}) {
  const indexHref = publicIndexHref(basePath);
  return (
    <PublicPageChrome
      siteName={site.name}
      tagline={site.description}
      homeHref={indexHref}
      homeHeading={homeHeading}
      presetId={site.theme}
      theme={siteTheme(site)}
      feedHref={`${basePath}/feed.xml`}
      subscribeVariant="footer"
      subscribeSiteSlug={site.slug}
      subscribeSettings={site.newsletter_settings}
    >
      {children}
    </PublicPageChrome>
  );
}

export function PublicBlogIndexView({
  data,
  page = 1,
}: {
  data: PublicIndexLoaderData & { listing?: PublicListingContext };
  page?: number;
}) {
  const { site, posts, basePath } = data;
  const listing: PublicListingContext = data.listing ?? DEFAULT_LISTING;
  const searchQuery = listing.kind === "search" ? listing.query : "";
  const indexHref = publicIndexHref(basePath);
  const totalPosts = data.totalPosts ?? posts.length;
  const pageCount = Math.max(1, Math.ceil(totalPosts / PUBLIC_INDEX_PAGE_SIZE));
  const current = Math.min(Math.max(1, data.page ?? page), pageCount);
  const visible = data.totalPosts === undefined ? posts.slice((current - 1) * PUBLIC_INDEX_PAGE_SIZE, current * PUBLIC_INDEX_PAGE_SIZE) : posts;
  const listingBase =
    listing.kind === "tag" ? `${basePath}/tag/${encodeURIComponent(listing.tag)}` : indexHref;

  return (
    <PublicPageChrome
      siteName={site.name}
      tagline={site.description}
      homeHref={indexHref}
      homeHeading={listing.kind === "index"}
      presetId={site.theme}
      theme={siteTheme(site)}
      searchAction={indexHref}
      searchQuery={searchQuery}
      feedHref={`${basePath}/feed.xml`}
      allPostsHref={listing.kind === "index" ? undefined : indexHref}
      modeToggle
      sidebar={sidebarData(basePath, data.sidebar)}
      subscribeVariant="footer"
      subscribeSiteSlug={site.slug}
      subscribeSettings={site.newsletter_settings}
    >
      {listing.kind === "tag" ? (
        <header className={styles.listingHeader}>
          <h1 className={styles.listingHeading}>Posts tagged {listing.tag}</h1>
          <p className={styles.listingCount}>
            {totalPosts} {totalPosts === 1 ? "post" : "posts"}
          </p>
        </header>
      ) : null}
      {listing.kind === "search" ? (
        <header className={styles.listingHeader}>
          <h1 className={styles.listingHeading}>Results for {listing.query}</h1>
          <p className={styles.listingCount}>
            {posts.length} {posts.length === 1 ? "result" : "results"}
          </p>
        </header>
      ) : null}
      {visible.length > 0 ? (
        <PublicPostList
          variant={templateOf(site).index}
          posts={visible.map((post) => {
            const coverMedia = post.cover_asset_id ? buildResponsiveMediaUrls(post.cover_asset_id) : undefined;
            return {
              id: post.id,
              title: post.title,
              href: `${basePath}/${post.slug}`,
              excerpt: post.excerpt,
              publishedAt: post.published_at,
              tags: parseTags(post.tags_json),
              cover: coverMedia
                ? { src: coverMedia.src, srcSet: coverMedia.srcSet, width: post.cover_asset_width, height: post.cover_asset_height }
                : null,
            };
          })}
        />
      ) : (
        <div className={styles.empty}>
          {listing.kind === "search" ? (
            <>
              <p>Nothing matches “{listing.query}”.</p>
              <a href={indexHref} className={styles.emptyLink}>
                Browse all posts
              </a>
            </>
          ) : (
            <p>No posts yet. Check back soon.</p>
          )}
        </div>
      )}
      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Pagination">
          {current > 1 ? (
            <a href={pageHref(listingBase, current - 1, searchQuery)} className={styles.pageLink} rel="prev">
              ← Newer
            </a>
          ) : (
            <span />
          )}
          <span className={styles.pageStatus}>
            Page {current} of {pageCount}
          </span>
          {current < pageCount ? (
            <a href={pageHref(listingBase, current + 1, searchQuery)} className={styles.pageLink} rel="next">
              Older →
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </PublicPageChrome>
  );
}

function adjacent(basePath: string, post: PublicPostLoaderData["newer"]) {
  return post ? { title: post.title, href: `${basePath}/${post.slug}`, publishedAt: post.publishedAt ?? null } : null;
}

/** Public author line: the owner's public name, credited as reviewer of agent-written posts. */
function postAuthor(data: PublicPostLoaderData): ArticleAuthor {
  return data.byline;
}

export function PublicBlogPostView({ data }: { data: PublicPostLoaderData }) {
  const { site, post, basePath } = data;
  const indexHref = publicIndexHref(basePath);
  const presetId = resolvePresetId(site.theme);
  const theme = siteTheme(site);
  const { resolved } = resolvePresentation(presetId, post.presentation);
  const renderResult = renderRichContent(post.content_markdown, {
    presetId,
    pageTitle: post.title,
    resolveImage: resolveResponsiveMediaSource,
    highlighter: codeHighlighter(),
  });
  const coverMedia = post.cover_asset_id
    ? buildResponsiveMediaUrls(post.cover_asset_id)
    : undefined;
  const showUpdated = shouldShowUpdatedDate(post.published_at, post.updated_at);

  return (
    <PublicPageChrome
      siteName={site.name}
      homeHref={indexHref}
      allPostsHref={indexHref}
      presetId={site.theme}
      theme={theme}
      article
      wide={articleHasToc(resolved, renderResult.outline)}
      layout={resolved.layout}
      modeToggle
      sidebar={sidebarData(basePath, data.sidebar)}
      feedHref={`${basePath}/feed.xml`}
      subscribeVariant="end"
      subscribeSiteSlug={site.slug}
      subscribeSettings={site.newsletter_settings}
    >
      <PresentedPostArticle
        renderResult={renderResult}
        presetId={presetId}
        presentation={resolved}
        title={post.title}
        excerpt={post.excerpt ?? undefined}
        coverAssetSrc={coverMedia?.src}
        coverAssetAlt={post.cover_asset_alt_text ?? undefined}
        coverAssetWidth={post.cover_asset_width ?? undefined}
        coverAssetHeight={post.cover_asset_height ?? undefined}
        coverAssetSrcSet={coverMedia?.srcSet}
        coverAssetSizes={
          resolved.layout === "feature"
            ? "(max-width: 1008px) calc(100vw - 40px), 1008px"
            : "(max-width: 700px) calc(100vw - 40px), 640px"
        }
        coverAssetLoading={coverMedia ? "eager" : undefined}
        coverAssetFetchPriority={coverMedia ? "high" : undefined}
        publishedAt={post.published_at}
        updatedAt={showUpdated ? post.updated_at : null}
        readingMinutes={readingTimeMinutes(post.content_markdown)}
        tags={parseTags(post.tags_json)}
        basePath={basePath}
        theme={theme}
        author={postAuthor(data)}
        actions={{
          markdownUrl: new URL(`${basePath}/${post.slug}.md`, data.origin).href,
          shareUrl: new URL(data.canonicalUrl, data.origin).href,
        }}
        newer={adjacent(basePath, data.newer)}
        older={adjacent(basePath, data.older)}
      />
    </PublicPageChrome>
  );
}

export function PublicNotFoundView({
  site,
}: {
  site: PublicIndexLoaderData["site"];
}) {
  return (
    <PublicPageChrome
      siteName={site.name}
      homeHref="/"
      allPostsHref="/"
      presetId={site.theme}
      theme={siteTheme(site)}
      feedHref="/feed.xml"
      modeToggle
    >
      <div className={styles.notFound}>
        <p className={styles.listingEyebrow}>404</p>
        <h1 className={styles.listingHeading}>This page doesn’t exist</h1>
        <p className={styles.notFoundText}>It may have been moved, unpublished, or never existed.</p>
        <a href="/" className={styles.emptyLink}>
          Back to all posts
        </a>
      </div>
    </PublicPageChrome>
  );
}

import { renderRichContent } from "@vc/content";
import {
  PresentedPostArticle,
  type SiteThemeInput,
} from "@vc/content/presented-post";
import { PublicPageChrome } from "@vc/content/public-chrome";
import { resolvePresetId, resolvePresentation } from "@vc/config";
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

export function PublicShell({
  site,
  basePath,
  indexable,
  children,
}: {
  site: PublicIndexLoaderData["site"];
  basePath: string;
  indexable: boolean;
  children: React.ReactNode;
}) {
  const homeHref = publicIndexHref(basePath);

  return (
    <PublicPageChrome
      siteName={site.name}
      tagline={site.description}
      homeHref={homeHref}
      presetId={site.theme}
      theme={{ accent: site.theme_accent, font: site.theme_font, mode: site.theme_mode }}
      robotsNoindex={!indexable}
      subscribeVariant="footer"
      subscribeSiteSlug={site.slug}
    >
      {children}
    </PublicPageChrome>
  );
}

export function PublicBlogIndexView({
  data,
}: {
  data: PublicIndexLoaderData & { listing?: PublicListingContext };
}) {
  const { site, posts, basePath, indexable } = data;
  const listing: PublicListingContext = data.listing ?? DEFAULT_LISTING;
  const searchQuery = listing.kind === "search" ? listing.query : "";
  const indexHref = publicIndexHref(basePath);

  return (
    <PublicShell site={site} basePath={basePath} indexable={indexable}>
      <form method="get" action={indexHref} className={styles.searchForm} role="search">
        <label htmlFor="public-blog-search" className={styles.searchLabel}>
          Search posts
        </label>
        <input
          id="public-blog-search"
          type="search"
          name="q"
          defaultValue={searchQuery}
          placeholder="Search posts..."
          className={styles.searchInput}
        />
        <button type="submit" className={styles.searchButton}>
          Search
        </button>
      </form>
      {listing.kind === "tag" ? (
        <div className={styles.listingBanner}>
          <h1 className={styles.listingHeading}>Posts tagged {listing.tag}</h1>
          <a href={indexHref} className={styles.backLink}>
            {"\u2190"} All posts
          </a>
        </div>
      ) : null}
      {listing.kind === "search" ? (
        <div className={styles.listingBanner}>
          <h1 className={styles.listingHeading}>Results for {listing.query}</h1>
        </div>
      ) : null}
      <section className={styles.postList}>
        {posts.map((post) => {
          const publishedText = post.published_at
            ? new Date(post.published_at * 1000).toLocaleDateString()
            : "Published";
          const coverMedia = post.cover_asset_id
            ? buildResponsiveMediaUrls(post.cover_asset_id)
            : undefined;
          return (
            <article className={styles.postCard} key={post.id}>
              {post.cover_asset_id ? (
                <img
                  className={styles.coverImage}
                  src={coverMedia?.src}
                  srcSet={coverMedia?.srcSet}
                  sizes="(max-width: 860px) calc(100vw - 32px), 860px"
                  alt={`Cover image for ${post.title}`}
                  width={post.cover_asset_width ?? 860}
                  height={post.cover_asset_height ?? 484}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              <h2>
                <a href={`${basePath}/${post.slug}`}>{post.title}</a>
              </h2>
              {post.excerpt ? <p>{post.excerpt}</p> : null}
              <p className={styles.metaLine}>{publishedText}</p>
            </article>
          );
        })}
        {posts.length === 0 && listing.kind === "search" ? (
          <p className={styles.empty}>No posts match {listing.query}.</p>
        ) : posts.length === 0 ? (
          <p className={styles.empty}>No published posts yet.</p>
        ) : null}
      </section>
    </PublicShell>
  );
}

export function PublicBlogPostView({ data }: { data: PublicPostLoaderData }) {
  const { site, post, basePath } = data;
  const indexHref = publicIndexHref(basePath);
  const presetId = resolvePresetId(site.theme);
  const siteTheme: SiteThemeInput = {
    accent: site.theme_accent,
    font: site.theme_font,
    mode: site.theme_mode,
  };
  const { resolved } = resolvePresentation(presetId, post.presentation);
  const renderResult = renderRichContent(post.content_markdown, {
    presetId,
    pageTitle: post.title,
    resolveImage: resolveResponsiveMediaSource,
  });
  const coverMedia = post.cover_asset_id
    ? buildResponsiveMediaUrls(post.cover_asset_id)
    : undefined;
  const dateText = post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : undefined;
  const updatedDateText = shouldShowUpdatedDate(post.published_at, post.updated_at)
    ? new Date(post.updated_at * 1000).toLocaleDateString()
    : undefined;
  const readingMinutes = readingTimeMinutes(post.content_markdown);
  const tags = parseTags(post.tags_json);

  return (
    <PublicPageChrome
      siteName={site.name}
      tagline={site.description}
      homeHref={indexHref}
      allPostsHref={indexHref}
      presetId={site.theme}
      theme={siteTheme}
      article
      subscribeVariant="end"
      subscribeSiteSlug={site.slug}
    >
      <PresentedPostArticle
        renderResult={renderResult}
        presetId={presetId}
        presentation={resolved}
        title={post.title}
        excerpt={post.excerpt ?? undefined}
        byline={site.name}
        coverAssetSrc={coverMedia?.src}
        coverAssetAlt={post.cover_asset_alt_text ?? undefined}
        coverAssetWidth={post.cover_asset_width ?? undefined}
        coverAssetHeight={post.cover_asset_height ?? undefined}
        coverAssetSrcSet={coverMedia?.srcSet}
        coverAssetSizes={
          resolved.layout === "feature"
            ? "(max-width: 1008px) calc(100vw - 32px), 1008px"
            : "(max-width: 720px) calc(100vw - 32px), 720px"
        }
        coverAssetLoading={coverMedia ? "eager" : undefined}
        coverAssetFetchPriority={coverMedia ? "high" : undefined}
        dateText={dateText}
        updatedDateText={updatedDateText}
        readingMinutes={readingMinutes}
        tags={tags}
        basePath={basePath}
        theme={siteTheme}
      />
    </PublicPageChrome>
  );
}
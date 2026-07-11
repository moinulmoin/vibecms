import styles from "./public-blog.module.css";
import { renderRichContent } from "~/lib/markdown";
import { readingTimeMinutes } from "~/lib/reading-time";
import type { PublicIndexLoaderData, PublicPostLoaderData } from "~/server/public-blog";
import { resolvePresetId, resolvePresentation } from "@vc/config";
import { SubscribeForm } from "./SubscribeForm";
import { PresentedPostArticle, resolveSiteTheme, type SiteThemeInput } from "./PresentedPostArticle";
import { shouldShowUpdatedDate } from "~/lib/seo-meta";

// Pinned seam - matches public-blog.ts once DataAndLoaders lands
type PublicListingContext =
  | { kind: "index" }
  | { kind: "tag"; tag: string }
  | { kind: "search"; query: string };

const DEFAULT_LISTING: PublicListingContext = { kind: "index" };

function RobotsMeta({ indexable }: { indexable: boolean }) {
  return indexable ? null : <meta name="robots" content="noindex,nofollow" />;
}

function publicIndexHref(basePath: string) {
  return basePath || "/";
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

function PublicShell({
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
  const seoTitle = site.default_seo_title || site.name;
  const seoDescription = site.default_seo_description || site.description || undefined;
  const homeHref = publicIndexHref(basePath);
  const themeAttrs = resolveSiteTheme({
    accent: site.theme_accent,
    font: site.theme_font,
    mode: site.theme_mode,
  });
  return (
    <main
      className={styles.publicPage}
      data-vc-theme={resolvePresetId(site.theme)}
      style={themeAttrs.style}
      {...(themeAttrs.mode === "light" || themeAttrs.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
    >
      {seoTitle ? <title>{seoTitle}</title> : null}
      <RobotsMeta indexable={indexable} />
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      {seoTitle ? <meta property="og:title" content={seoTitle} /> : null}
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <header className={styles.publicHeader}>
        <a href={homeHref} className={styles.publicBrand}>
          {site.name}
        </a>
        {site.description ? <p className={styles.publicTagline}>{site.description}</p> : null}
      </header>
      {children}
      <footer>
        <SubscribeForm siteSlug={site.slug} placement="footer" />
      </footer>
    </main>
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
      <form
        method="get"
        action={indexHref}
        className={styles.searchForm}
        role="search"
      >
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

      {listing.kind === "tag" && (
        <div className={styles.listingBanner}>
          <h1 className={styles.listingHeading}>Posts tagged {listing.tag}</h1>
          <a href={indexHref} className={styles.backLink}>
            {"\u2190"} All posts
          </a>
        </div>
      )}

      {listing.kind === "search" && (
        <div className={styles.listingBanner}>
          <h1 className={styles.listingHeading}>Results for {listing.query}</h1>
        </div>
      )}

      {/* §4: single-column, borderless list. Entry = title + excerpt + date · read-time. */}
      <section className={styles.postList}>
        {posts.map((post) => {
          const publishedText = post.published_at
            ? new Date(post.published_at * 1000).toLocaleDateString()
            : "Published";
          const metaLine = [publishedText, `${readingTimeMinutes(post.content_markdown)} min read`].join(
            " \u00b7 ",
          );
          return (
            <article className={styles.postCard} key={post.id}>
              {post.cover_asset_id ? (
                <img
                  className={styles.coverImage}
                  src={`/media-assets/${post.cover_asset_id}`}
                  alt={`Cover image for ${post.title}`}
                  width={860}
                  height={484}
                  loading="lazy"
                />
              ) : null}
              <h2>
                <a href={`${basePath}/${post.slug}`}>{post.title}</a>
              </h2>
              {post.excerpt ? <p>{post.excerpt}</p> : null}
              <p className={styles.metaLine}>{metaLine}</p>
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
  const themeAttrs = resolveSiteTheme(siteTheme);
  const { resolved } = resolvePresentation(presetId, post.presentation);
  const renderResult = renderRichContent(post.content_markdown, { presetId });
  const coverAssetSrc = post.cover_asset_id ? `/media-assets/${post.cover_asset_id}` : undefined;
  const dateText = post.published_at
    ? new Date(post.published_at * 1000).toLocaleDateString()
    : undefined;
  const updatedDateText = shouldShowUpdatedDate(post.published_at, post.updated_at)
    ? new Date(post.updated_at * 1000).toLocaleDateString()
    : undefined;
  // §2: reading time, render-level (no DB column). §3: ToC rail flag drives the >=1100px layout.
  const readingMinutes = readingTimeMinutes(post.content_markdown);
  const hasToc = resolved.toc && renderResult.outline.length >= 3;
  const tags = parseTags(post.tags_json);

  return (
    <main
      className={styles.publicPage}
      data-vc-theme={presetId}
      data-vc-toc-rail={hasToc ? "" : undefined}
      style={themeAttrs.style}
      {...(themeAttrs.mode === "light" || themeAttrs.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
    >
      <header className={styles.publicHeader}>
        <a href={indexHref} className={styles.publicBrand}>
          {site.name}
        </a>
        {site.description ? <p className={styles.publicTagline}>{site.description}</p> : null}
      </header>
      <a href={indexHref} className={styles.backLink}>
        {"\u2190"} All posts
      </a>
      <PresentedPostArticle
        renderResult={renderResult}
        presetId={presetId}
        presentation={resolved}
        title={post.title}
        coverAssetSrc={coverAssetSrc}
        dateText={dateText}
        updatedDateText={updatedDateText}
        readingMinutes={readingMinutes}
        tags={tags}
        basePath={basePath}
        theme={siteTheme}
      />
      <SubscribeForm siteSlug={site.slug} placement="end" />
    </main>
  );
}

export function PublicBlogNotFound({
  site,
  basePath,
}: {
  site: PublicIndexLoaderData["site"];
  basePath: string;
}) {
  const homeHref = publicIndexHref(basePath);
  const themeAttrs = resolveSiteTheme({
    accent: site.theme_accent,
    font: site.theme_font,
    mode: site.theme_mode,
  });
  return (
    <main
      className={styles.publicPage}
      data-vc-theme={resolvePresetId(site.theme)}
      style={themeAttrs.style}
      {...(themeAttrs.mode === "light" || themeAttrs.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
    >
      <title>{`Not found - ${site.name}`}</title>
      <meta name="robots" content="noindex" />
      <header className={styles.publicHeader}>
        <a href={homeHref} className={styles.publicBrand}>
          {site.name}
        </a>
      </header>
      <section className={styles.notFound}>
        <h1>Post not found</h1>
        <p>That post does not exist or is no longer published.</p>
        <a href={homeHref} className={styles.backLink}>
          {"\u2190"} All posts
        </a>
      </section>
    </main>
  );
}

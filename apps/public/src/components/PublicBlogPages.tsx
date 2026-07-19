import { renderRichContent } from "@vc/content";
import { resolvePresetId, resolvePresentation } from "@vc/config";
import type {
  PublicIndexLoaderData,
  PublicListingContext,
  PublicPostLoaderData,
} from "../server/public-blog";
import { readingTimeMinutes } from "../lib/reading-time";
import { shouldShowUpdatedDate } from "../lib/seo-meta";
import styles from "./public-blog.module.css";
import { PresentedPostArticle, resolveSiteTheme, type SiteThemeInput } from "./PresentedPostArticle";
import {
  SUBSCRIBE_BUTTON,
  SUBSCRIBE_CONSENT_TEXT,
  SUBSCRIBE_HEADING,
  SUBSCRIBE_SUBTEXT,
  SUBSCRIBE_SUCCESS,
} from "../lib/subscribe-consent";
import subscribeStyles from "./subscribe-form.module.css";
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
      {...(themeAttrs.mode === "light" || themeAttrs.mode === "dark" ? { "data-vc-mode": themeAttrs.mode } : {})}
    >
      <div className={styles.publicContainer}>
        {!indexable ? <meta name="robots" content="noindex,nofollow" /> : null}
        <header className={styles.publicHeader}>
          <a href={homeHref} className={styles.publicBrand}>
            {site.name}
          </a>
          {site.description ? <p className={styles.publicTagline}>{site.description}</p> : null}
        </header>
        {children}
        <footer>
          <form className={`${subscribeStyles.form} ${subscribeStyles.formFooter} vc-subscribe-form`} data-site-slug={site.slug} noValidate>
            <p className={subscribeStyles.heading}>{SUBSCRIBE_HEADING}</p>
            <p className={subscribeStyles.subtext}>{SUBSCRIBE_SUBTEXT}</p>
            <div className={subscribeStyles.honeypot} aria-hidden="true">
              <input name="company" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <div className={subscribeStyles.row}>
              <label className={subscribeStyles.emailLabel} htmlFor={`email-footer-${site.slug}`}>
                Email address
              </label>
              <input
                id={`email-footer-${site.slug}`}
                name="email"
                type="email"
                required
                className={`${subscribeStyles.emailInput} ${subscribeStyles.input}`}
                placeholder="you@example.com"
              />
              <button type="submit" className={subscribeStyles.submitBtn}>
                {SUBSCRIBE_BUTTON}
              </button>
            </div>
            <p className={subscribeStyles.consentNote}>{SUBSCRIBE_CONSENT_TEXT}</p>
            <p className={subscribeStyles.errorMsg} hidden data-subscribe-error />
            <p className={subscribeStyles.successMsg} hidden data-subscribe-success>
              {SUBSCRIBE_SUCCESS}
            </p>
          </form>
        </footer>
      </div>
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
          const metaLine = [publishedText, `${readingTimeMinutes(post.content_markdown)} min read`].join(" \u00b7 ");
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
  const renderResult = renderRichContent(post.content_markdown, { presetId, pageTitle: post.title });
  const coverAssetSrc = post.cover_asset_id ? `/media-assets/${post.cover_asset_id}` : undefined;
  const dateText = post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : undefined;
  const updatedDateText = shouldShowUpdatedDate(post.published_at, post.updated_at)
    ? new Date(post.updated_at * 1000).toLocaleDateString()
    : undefined;
  const readingMinutes = readingTimeMinutes(post.content_markdown);
  const tags = parseTags(post.tags_json);

  return (
    <main
      className={styles.publicPage}
      data-vc-theme={presetId}
      data-vc-article-page=""
      style={themeAttrs.style}
      {...(themeAttrs.mode === "light" || themeAttrs.mode === "dark" ? { "data-vc-mode": themeAttrs.mode } : {})}
    >
      <div className={styles.publicContainer}>
        <header className={styles.publicHeader}>
          <a href={indexHref} className={styles.publicBrand}>
            {site.name}
          </a>
          {site.description ? <p className={styles.publicTagline}>{site.description}</p> : null}
          <nav className={styles.mastheadNav} aria-label="Posts">
            <a href={indexHref} className={styles.allPostsLink}>All posts</a>
          </nav>
        </header>
        <PresentedPostArticle
          renderResult={renderResult}
          presetId={presetId}
          presentation={resolved}
          title={post.title}
          excerpt={post.excerpt ?? undefined}
          byline={site.name}
          coverAssetSrc={coverAssetSrc}
          coverAssetAlt={post.cover_asset_alt_text ?? undefined}
          coverAssetWidth={post.cover_asset_width ?? undefined}
          coverAssetHeight={post.cover_asset_height ?? undefined}
          dateText={dateText}
          updatedDateText={updatedDateText}
          readingMinutes={readingMinutes}
          tags={tags}
          basePath={basePath}
          theme={siteTheme}
        />
        <form className={`${subscribeStyles.form} ${subscribeStyles.formEnd} vc-subscribe-form`} data-site-slug={site.slug} noValidate>
          <p className={subscribeStyles.heading}>{SUBSCRIBE_HEADING}</p>
          <p className={subscribeStyles.subtext}>{SUBSCRIBE_SUBTEXT}</p>
          <div className={subscribeStyles.honeypot} aria-hidden="true">
            <input name="company" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div className={subscribeStyles.row}>
            <label className={subscribeStyles.emailLabel} htmlFor={`email-end-${site.slug}`}>
              Email address
            </label>
            <input
              id={`email-end-${site.slug}`}
              name="email"
              type="email"
              required
              className={`${subscribeStyles.emailInput} ${subscribeStyles.input}`}
              placeholder="you@example.com"
            />
            <button type="submit" className={subscribeStyles.submitBtn}>
              {SUBSCRIBE_BUTTON}
            </button>
          </div>
          <p className={subscribeStyles.consentNote}>{SUBSCRIBE_CONSENT_TEXT}</p>
          <p className={subscribeStyles.errorMsg} hidden data-subscribe-error />
          <p className={subscribeStyles.successMsg} hidden data-subscribe-success>
            {SUBSCRIBE_SUCCESS}
          </p>
        </form>
      </div>
    </main>
  );
}
import styles from "./public-blog.module.css";
import { renderRichContent, RichContentFrame } from "~/lib/markdown";
import type { PublicIndexLoaderData, PublicPostLoaderData } from "~/server/public-blog";
import { resolvePresetId } from "@vc/config";
import { SubscribeForm } from "~/components/SubscribeForm";

function MarkdownBody({ source, presetId }: { source: string; presetId: string }) {
  const { node } = renderRichContent(source);
  return <RichContentFrame node={node} presetId={presetId} />;
}

function RobotsMeta({ indexable }: { indexable: boolean }) {
  return indexable ? null : <meta name="robots" content="noindex,nofollow" />;
}

function publicIndexHref(basePath: string) {
  return basePath || "/";
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
  return (
    <main className={styles.publicPage} data-vc-theme={resolvePresetId(site.theme)}>
      {seoTitle ? <title>{seoTitle}</title> : null}
      <RobotsMeta indexable={indexable} />
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      {seoTitle ? <meta property="og:title" content={seoTitle} /> : null}
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <header className={styles.publicHeader}>
        <a href={homeHref} className={styles.publicBrand}>
          {site.name}
        </a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      {children}
      <footer>
        <SubscribeForm siteSlug={site.slug} placement="footer" />
      </footer>
    </main>
  );
}

export function PublicBlogIndexView({ data }: { data: PublicIndexLoaderData }) {
  const { site, posts, basePath, indexable } = data;
  return (
    <PublicShell site={site} basePath={basePath} indexable={indexable}>
      <section className={styles.postList}>
        {posts.map((post) => (
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
            <p>{post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : "Published"}</p>
            <h2>
              <a href={`${basePath}/${post.slug}`}>{post.title}</a>
            </h2>
            {post.excerpt ? <p>{post.excerpt}</p> : null}
          </article>
        ))}
        {posts.length === 0 ? <p className={styles.empty}>No published posts yet.</p> : null}
      </section>
    </PublicShell>
  );
}

export function PublicBlogPostView({ data }: { data: PublicPostLoaderData }) {
  const { site, post, basePath, canonicalUrl, indexable } = data;
  const seoTitle = post.seo_title || `${post.title} - ${site.name}`;
  const seoDescription = post.seo_description || post.excerpt || undefined;
  const indexHref = publicIndexHref(basePath);
  const ogImage = post.cover_asset_id ? `/media-assets/${post.cover_asset_id}` : "/brand/og.png";

  return (
    <main className={styles.publicPage} data-vc-theme={resolvePresetId(site.theme)}>
      <title>{seoTitle}</title>
      <RobotsMeta indexable={indexable} />
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      <meta property="og:title" content={seoTitle} />
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <meta property="og:type" content="article" />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content={ogImage} />
      <link rel="canonical" href={canonicalUrl} />
      <header className={styles.publicHeader}>
        <a href={indexHref} className={styles.publicBrand}>
          {site.name}
        </a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      <article className={styles.article}>
        <a href={indexHref} className={styles.backLink}>
          {"\u2190"} All posts
        </a>
        <h1 className={styles.articleTitle}>{post.title}</h1>
        {post.cover_asset_id ? (
          <img
            className={styles.heroImage}
            src={`/media-assets/${post.cover_asset_id}`}
            alt={`Cover image for ${post.title}`}
            width={860}
            height={520}
            loading="lazy"
          />
        ) : null}
        <p className={styles.date}>
          {post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : "Published"}
        </p>
        <MarkdownBody source={post.content_markdown} presetId={resolvePresetId(site.theme)} />
      </article>
      <SubscribeForm siteSlug={site.slug} placement="end" />
    </main>
  );
}

export function PublicBlogNotFound({ site, basePath }: { site: PublicIndexLoaderData["site"]; basePath: string }) {
  const homeHref = publicIndexHref(basePath);
  return (
    <main className={styles.publicPage} data-vc-theme={resolvePresetId(site.theme)}>
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
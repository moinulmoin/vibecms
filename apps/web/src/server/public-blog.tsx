import { env } from "cloudflare:workers";
import styles from "@/app/pages/public-blog.module.css";
import { parseMarkdown } from "@/lib/markdown";
import { isLocalDefaultHostname, publicBlogBaseDomain } from "./onboarding";

export type SiteRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  default_seo_title: string | null;
  default_seo_description: string | null;
  billing_status: string | null;
  current_period_end: number | null;
  published_count: number | null;
};

export type PostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_markdown: string;
  cover_asset_id: string | null;
  published_at: number | null;
  seo_title: string | null;
  seo_description: string | null;
  tags_json: string;
};

function normalizeHost(request: Request) {
  return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

function appHost() {
  try {
    return new URL(env.APP_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
}


function canRenderPublic(site: SiteRow) {
  // A blog has a public presence when paid, self-hosted, or it has used its free
  // published post (the "publish one to try" allowance). Free posts are noindex.
  return env.SELF_HOSTED === "true" || site.billing_status === "active" || (site.published_count ?? 0) > 0;
}

export async function resolveSite(request: Request) {
  const host = normalizeHost(request);
  if (!host || host === "localhost" || host === appHost() || host.startsWith("app.") || (isLocalDefaultHostname(host) && publicBlogBaseDomain())) return null;

  const site = await env.DB.prepare(
    `SELECT sites.id, sites.workspace_id, sites.name, sites.slug, sites.description,
      sites.default_seo_title, sites.default_seo_description,
      billing_customers.status AS billing_status, billing_customers.current_period_end,
      (SELECT COUNT(*) FROM posts WHERE posts.site_id = sites.id AND posts.status = 'published') AS published_count
     FROM domains
     INNER JOIN sites ON sites.id = domains.site_id
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE domains.hostname = ? AND domains.status = 'active' AND sites.status = 'active'
     LIMIT 1`,
  ).bind(host).first<SiteRow>();
  if (!site || !canRenderPublic(site)) return null;
  return site;
}

export async function resolveSiteBySlug(slug: string | undefined) {
  if (!slug) return null;
  const site = await env.DB.prepare(
    `SELECT sites.id, sites.workspace_id, sites.name, sites.slug, sites.description,
      sites.default_seo_title, sites.default_seo_description,
      billing_customers.status AS billing_status, billing_customers.current_period_end,
      (SELECT COUNT(*) FROM posts WHERE posts.site_id = sites.id AND posts.status = 'published') AS published_count
     FROM sites
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE sites.slug = ? AND sites.status = 'active'
     LIMIT 1`,
  ).bind(slug).first<SiteRow>();
  if (!site || !canRenderPublic(site)) return null;
  return site;
}


export async function listPublishedPosts(siteId: string) {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, content_markdown, cover_asset_id, published_at, seo_title, seo_description, tags_json
     FROM posts
     WHERE site_id = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?
     ORDER BY published_at DESC`,
  ).bind(siteId, now).all<PostRow>();
  return result.results;
}

export async function getPublishedPost(siteId: string, slug: string) {
  const now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(
    `SELECT id, title, slug, excerpt, content_markdown, cover_asset_id, published_at, seo_title, seo_description, tags_json
     FROM posts
     WHERE site_id = ? AND slug = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?
     LIMIT 1`,
  ).bind(siteId, slug, now).first<PostRow>();
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

function markdownRequested(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/markdown") || new URL(request.url).searchParams.get("format") === "md";
}

function stripMarkdownSuffix(slug: string | undefined): { slug: string | undefined; markdown: boolean } {
  if (slug && slug.endsWith(".md")) return { slug: slug.slice(0, -3), markdown: true };
  return { slug, markdown: false };
}

function buildPostMarkdown(post: PostRow, canonicalUrl: string) {
  const description = post.seo_description || post.excerpt || "";
  const date = post.published_at ? new Date(post.published_at * 1000).toISOString() : "";
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(post.tags_json) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {}
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(post.title)}`,
    description ? `description: ${JSON.stringify(description)}` : null,
    date ? `date: ${date}` : null,
    tags.length ? `tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]` : null,
    `canonical: ${canonicalUrl}`,
    "---",
  ].filter((line): line is string => line !== null).join("\n");
  return `${frontmatter}\n\n# ${post.title}\n\n${post.content_markdown}\n`;
}

async function publicPostMarkdownResponse(site: SiteRow, slug: string, canonicalUrl: string) {
  const post = await getPublishedPost(site.id, slug);
  if (!post) return notFound();
  return new Response(buildPostMarkdown(post, canonicalUrl), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": publicCacheControl,
      "content-signal": "ai-train=yes, search=yes, ai-input=yes",
    },
  });
}

function Markdown({ source }: { source: string }) {
  return <div className={styles.markdown}>{parseMarkdown(source)}</div>;
}

function publicIndexHref(basePath: string) {
  return basePath || "/";
}

function PublicNotFound({ site, basePath }: { site: SiteRow; basePath: string }) {
  const homeHref = publicIndexHref(basePath);
  return (
    <main className={styles.publicPage}>
      <title>{`Not found - ${site.name}`}</title>
      <meta name="robots" content="noindex" />
      <header className={styles.publicHeader}>
        <a href={homeHref} className={styles.publicBrand}>{site.name}</a>
      </header>
      <section className={styles.notFound}>
        <h1>Post not found</h1>
        <p>That post does not exist or is no longer published.</p>
        <a href={homeHref} className={styles.backLink}>{"\u2190"} All posts</a>
      </section>
    </main>
  );
}

export function isPublicBlogIndexable(site: SiteRow) {
  return env.SELF_HOSTED === "true" || site.billing_status === "active";
}

function PublicShell({ site, basePath, children }: { site: SiteRow; basePath: string; children: React.ReactNode }) {
  const seoTitle = site.default_seo_title || site.name;
  const seoDescription = site.default_seo_description || site.description || undefined;
  const indexable = isPublicBlogIndexable(site);
  const homeHref = publicIndexHref(basePath);
  return (
    <main className={styles.publicPage}>
      {seoTitle ? <title>{seoTitle}</title> : null}
      <RobotsMeta indexable={indexable} />
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      {seoTitle ? <meta property="og:title" content={seoTitle} /> : null}
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <header className={styles.publicHeader}>
        <a href={homeHref} className={styles.publicBrand}>{site.name}</a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      {children}
    </main>
  );
}

function RobotsMeta({ indexable }: { indexable: boolean }) {
  return indexable ? null : <meta name="robots" content="noindex,nofollow" />;
}

async function renderPublicIndex(site: SiteRow, basePath: string) {
  const posts = await listPublishedPosts(site.id);
  return (
    <PublicShell site={site} basePath={basePath}>
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
            <h2><a href={`${basePath}/${post.slug}`}>{post.title}</a></h2>
            {post.excerpt ? <p>{post.excerpt}</p> : null}
          </article>
        ))}
        {posts.length === 0 ? <p className={styles.empty}>No published posts yet.</p> : null}
      </section>
    </PublicShell>
  );
}

export async function PublicIndex({ request }: { request: Request }) {
  const site = await resolveSite(request);
  if (!site) return null;
  return renderPublicIndex(site, "");
}

async function renderPublicPost(request: Request, site: SiteRow, basePath: string, slug: string | undefined) {
  if (!slug) return <PublicNotFound site={site} basePath={basePath} />;
  const post = await getPublishedPost(site.id, slug);
  if (!post) return <PublicNotFound site={site} basePath={basePath} />;

  const seoTitle = post.seo_title || `${post.title} - ${site.name}`;
  const seoDescription = post.seo_description || post.excerpt || undefined;
  const canonicalUrl = new URL(`${basePath}/${post.slug}`, request.url).href;
  const indexable = isPublicBlogIndexable(site);
  const indexHref = publicIndexHref(basePath);

  return (
    <main className={styles.publicPage}>
      <title>{seoTitle}</title>
      <RobotsMeta indexable={indexable} />
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      <meta property="og:title" content={seoTitle} />
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <meta property="og:type" content="article" />
      <link rel="canonical" href={canonicalUrl} />
      <header className={styles.publicHeader}>
        <a href={indexHref} className={styles.publicBrand}>{site.name}</a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      <article className={styles.article}>
        <a href={indexHref} className={styles.backLink}>{"\u2190"} All posts</a>
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
        <p className={styles.date}>{post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : "Published"}</p>
        <Markdown source={post.content_markdown} />
      </article>
    </main>
  );
}

export async function PublicPost({ request, params }: { request: Request; params: { slug?: string } }) {
  const site = await resolveSite(request);
  if (!site) return notFound();
  const { slug, markdown } = stripMarkdownSuffix(params.slug);
  if (markdown || markdownRequested(request)) {
    if (!slug) return notFound();
    return publicPostMarkdownResponse(site, slug, new URL(`/${slug}`, request.url).href);
  }
  return renderPublicPost(request, site, "", slug);
}

export async function PublicIndexBySlug({ params }: { request: Request; params: { siteSlug?: string } }) {
  const site = await resolveSiteBySlug(params.siteSlug);
  if (!site) return notFound();
  return renderPublicIndex(site, `/blog/${site.slug}`);
}

export async function PublicPostBySlug({ request, params }: { request: Request; params: { siteSlug?: string; postSlug?: string } }) {
  const site = await resolveSiteBySlug(params.siteSlug);
  if (!site) return notFound();
  const { slug, markdown } = stripMarkdownSuffix(params.postSlug);
  if (markdown || markdownRequested(request)) {
    if (!slug) return notFound();
    return publicPostMarkdownResponse(site, slug, new URL(`/blog/${site.slug}/${slug}`, request.url).href);
  }
  return renderPublicPost(request, site, `/blog/${site.slug}`, slug);
}

export async function shouldRenderPublic(request: Request) {
  return Boolean(await resolveSite(request));
}

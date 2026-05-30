import { env } from "cloudflare:workers";
import styles from "@/app/pages/public-blog.module.css";

type SiteRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  default_seo_title: string | null;
  default_seo_description: string | null;
  billing_status: string | null;
  current_period_end: number | null;
};

type PostRow = {
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

function now() {
  return Math.floor(Date.now() / 1000);
}

function canRenderPublic(site: SiteRow) {
  if (env.SELF_HOSTED === "true") return true;
  if (site.billing_status === "active") return true;
  return site.billing_status === "trialing" && (!site.current_period_end || site.current_period_end >= now());
}

async function resolveSite(request: Request) {
  const host = normalizeHost(request);
  if (!host || host === "localhost" || host === appHost() || host.startsWith("app.")) return null;

  const site = await env.DB.prepare(
    `SELECT sites.id, sites.workspace_id, sites.name, sites.slug, sites.description,
      sites.default_seo_title, sites.default_seo_description,
      billing_customers.status AS billing_status, billing_customers.current_period_end
     FROM domains
     INNER JOIN sites ON sites.id = domains.site_id
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE domains.hostname = ? AND domains.status = 'active' AND sites.status = 'active'
     LIMIT 1`,
  ).bind(host).first<SiteRow>();
  return site && canRenderPublic(site) ? site : null;
}

async function listPublishedPosts(siteId: string) {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `SELECT id, title, slug, excerpt, content_markdown, cover_asset_id, published_at, seo_title, seo_description, tags_json
     FROM posts
     WHERE site_id = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?
     ORDER BY published_at DESC`,
  ).bind(siteId, now).all<PostRow>();
  return result.results;
}

async function getPublishedPost(siteId: string, slug: string) {
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

function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.startsWith("### ")) return <h3 key={index}>{block.slice(4)}</h3>;
        if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
        if (block.startsWith("# ")) return <h1 key={index}>{block.slice(2)}</h1>;
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

function PublicShell({ site, children }: { site: SiteRow; children: React.ReactNode }) {
  return (
    <main className={styles.publicPage}>
      <header className={styles.publicHeader}>
        <a href="/" className={styles.publicBrand}>{site.name}</a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      {children}
    </main>
  );
}

export async function PublicIndex({ request }: { request: Request }) {
  const site = await resolveSite(request);
  if (!site) return null;
  const posts = await listPublishedPosts(site.id);
  return (
    <PublicShell site={site}>
      <section className={styles.postList}>
        {posts.map((post) => (
          <article className={styles.postCard} key={post.id}>
            {post.cover_asset_id ? <img className={styles.coverImage} src={`/media-assets/${post.cover_asset_id}`} alt="" /> : null}
            <p>{post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : "Published"}</p>
            <h2><a href={`/${post.slug}`}>{post.title}</a></h2>
            {post.excerpt ? <p>{post.excerpt}</p> : null}
          </article>
        ))}
        {posts.length === 0 ? <p className={styles.empty}>No published posts yet.</p> : null}
      </section>
    </PublicShell>
  );
}

export async function PublicPost({ request, params }: { request: Request; params: { slug?: string } }) {
  const site = await resolveSite(request);
  if (!site) return notFound();
  const slug = params.slug;
  if (!slug) return notFound();
  const post = await getPublishedPost(site.id, slug);
  if (!post) return notFound();
  return (
    <PublicShell site={site}>
      <article className={styles.article}>
        <a href="/" className={styles.backLink}>← All posts</a>
        {post.cover_asset_id ? <img className={styles.heroImage} src={`/media-assets/${post.cover_asset_id}`} alt="" /> : null}
        <p className={styles.date}>{post.published_at ? new Date(post.published_at * 1000).toLocaleDateString() : "Published"}</p>
        <Markdown source={post.content_markdown} />
      </article>
    </PublicShell>
  );
}

export async function shouldRenderPublic(request: Request) {
  return Boolean(await resolveSite(request));
}

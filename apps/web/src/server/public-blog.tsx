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

/**
 * Restrict link hrefs to safe schemes. Post markdown is authored by humans and
 * agents, so block javascript:/data:/vbscript: URLs to prevent stored XSS on the
 * public blog. Returns "#" for anything that is not http(s), mailto, or a
 * relative/anchor link. React already escapes attribute values, so the raw URL
 * (including `&` in query strings) is passed through unchanged.
 */
function safeHref(raw: string): string {
  const href = raw.trim();
  // Reject protocol-relative URLs (//host) before the relative-path branch.
  if (href.startsWith("//")) return "#";
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "#";
}

/**
 * Inline markdown parser. Renders as React elements - never injects raw HTML.
 * Supports: headings (h1-h3), paragraphs, bold, italic, inline code,
 * code blocks, links, lists (ul/ol), blockquotes, and horizontal rules.
 */
function Markdown({ source }: { source: string }) {
  const elements = parseMarkdown(source);
  return <div className={styles.markdown}>{elements}</div>;
}

function parseMarkdown(source: string): React.ReactNode[] {
  const lines = source.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let keyIndex = 0;

  const key = () => keyIndex++;

  // Process inline formatting: bold, italic, inline code, links
  function inline(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let partKey = 0;

    while (remaining.length > 0) {
      // Inline code
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
      // Bold + italic
      const boldItalicMatch = remaining.match(/^(.*?)\*\*\*(.+?)\*\*\*/);
      // Bold
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
      // Italic
      const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/);
      // Link
      const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/);

      // Find earliest match
      const candidates = [
        { match: codeMatch, type: "code" },
        { match: boldItalicMatch, type: "bolditalic" },
        { match: boldMatch, type: "bold" },
        { match: italicMatch, type: "italic" },
        { match: linkMatch, type: "link" },
      ].filter((c) => c.match) as { match: RegExpMatchArray; type: string }[];

      if (candidates.length === 0) {
        parts.push(remaining);
        break;
      }

      // Pick the one with shortest prefix
      candidates.sort((a, b) => (a.match![1].length) - (b.match![1].length));
      const earliest = candidates[0];
      const m = earliest.match!;

      if (m[1]) parts.push(m[1]);

      switch (earliest.type) {
        case "code":
          parts.push(<code key={partKey++}>{m[2]}</code>);
          break;
        case "bolditalic":
          parts.push(<strong key={partKey++}><em>{inline(m[2])}</em></strong>);
          break;
        case "bold":
          parts.push(<strong key={partKey++}>{inline(m[2])}</strong>);
          break;
        case "italic":
          parts.push(<em key={partKey++}>{inline(m[2])}</em>);
          break;
        case "link": {
          parts.push(
            <a key={partKey++} href={safeHref(m[3])} rel="nofollow noopener noreferrer">
              {m[2]}
            </a>
          );
          break;
        }
      }

      remaining = remaining.slice(m[0].length);
    }

    return parts;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={key()}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = inline(headingMatch[2]);
      if (level === 1) elements.push(<h1 key={key()}>{content}</h1>);
      else if (level === 2) elements.push(<h2 key={key()}>{content}</h2>);
      else elements.push(<h3 key={key()}>{content}</h3>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      elements.push(<hr key={key()} />);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      elements.push(<blockquote key={key()}><p>{inline(quoteLines.join(" "))}</p></blockquote>);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^[-*+]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={key()}>
          {items.map((item, idx) => <li key={idx}>{inline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={key()}>
          {items.map((item, idx) => <li key={idx}>{inline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Paragraph - collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith(">") &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*+]\s/.test(lines[i].trimStart()) &&
      !/^\d+\.\s/.test(lines[i].trimStart()) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(<p key={key()}>{inline(paraLines.join(" "))}</p>);
    }
  }

  return elements;
}

function PublicShell({ site, children }: { site: SiteRow; children: React.ReactNode }) {
  const seoTitle = site.default_seo_title || site.name;
  const seoDescription = site.default_seo_description || site.description || undefined;
  return (
    <main className={styles.publicPage}>
      {seoTitle ? <title>{seoTitle}</title> : null}
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      {seoTitle ? <meta property="og:title" content={seoTitle} /> : null}
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
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

  const seoTitle = post.seo_title || `${post.title} - ${site.name}`;
  const seoDescription = post.seo_description || post.excerpt || undefined;
  const canonicalUrl = new URL(`/${post.slug}`, request.url).href;

  return (
    <main className={styles.publicPage}>
      <title>{seoTitle}</title>
      {seoDescription ? <meta name="description" content={seoDescription} /> : null}
      <meta property="og:title" content={seoTitle} />
      {seoDescription ? <meta property="og:description" content={seoDescription} /> : null}
      <meta property="og:type" content="article" />
      <link rel="canonical" href={canonicalUrl} />
      <header className={styles.publicHeader}>
        <a href="/" className={styles.publicBrand}>{site.name}</a>
        {site.description ? <p>{site.description}</p> : null}
      </header>
      <article className={styles.article}>
        <a href="/" className={styles.backLink}>{"\u2190"} All posts</a>
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

export async function shouldRenderPublic(request: Request) {
  return Boolean(await resolveSite(request));
}

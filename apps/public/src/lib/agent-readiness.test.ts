import { describe, expect, it } from "vitest";
import { agentPitch } from "./agent-discovery";
import { agentSkillsIndex, apiCatalog, authMarkdown, marketingHomeLinks, marketingLlmsTxt, marketingMarkdown, markdownErrorForRequest, markdownNotFound, marketingTrustRedirect, varyAgentRepresentation, mcpServerCard, skillArtifacts, tenantHomeLinks } from "./agent-discovery";
import { listingMarkdown, marketingJsonLd, tenantBlogJsonLd } from "./agent-pages";
import { publicHtmlResponseHeaders } from "../server/public-blog";
import type { PublicIndexLoaderData } from "../server/public-blog";

const app = "https://app.basedui.dev";
const origin = "https://basedui.dev";

describe("public agent discovery", () => {
  it("starts the marketing Markdown with the supplied pitch and links docs", () => {
    const body = marketingMarkdown(app);
    expect(body.startsWith(agentPitch({ appUrl: app }))).toBe(true);
    expect(body).toContain("## Docs");
    expect(body).toContain(`${app}/openapi.json`);
    const llms = marketingLlmsTxt(app, "# Documentation\n\n- [API](/docs/api)");
    expect(llms.startsWith(agentPitch({ appUrl: app }))).toBe(true);
    expect(llms).toContain("## Docs\n\n### Documentation");
  });

  it("builds typed discovery documents with runtime app URLs and skill digests", async () => {
    const catalog = apiCatalog(app, origin);
    expect(catalog.linkset[0].anchor).toBe(`${app}/api/v1`);
    expect(catalog.linkset[0]["service-desc"][0].href).toBe(`${app}/openapi.json`);
    const card = mcpServerCard(app, "0.1.0");
    expect(card.endpoint).toBe(`${app}/mcp`);
    expect(card.capabilities).toEqual({ tools: {} });
    const index = await agentSkillsIndex(origin);
    expect(index.skills.map((skill) => skill.name)).toEqual(["vibecms-core", "vibecms-writing"]);
    for (const skill of index.skills) {
      const bytes = new TextEncoder().encode(skillArtifacts[skill.name as keyof typeof skillArtifacts]);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      expect(skill.digest).toBe(`sha256:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")}`);
    }
    expect(authMarkdown(app, origin)).toContain("Authorization: Bearer");
  });

  it("advertises discovery links and a Markdown 404", async () => {
    expect(marketingHomeLinks(origin, app)).toContain('rel="api-catalog"');
    expect(marketingHomeLinks(origin, app)).toContain(`${app}/openapi.json`);
    expect(tenantHomeLinks("https://blog.example.com")).toContain('rel="alternate"; type="application/rss+xml"');
    const missing = markdownNotFound();
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/markdown");
    expect(missing.headers.get("vary")).toBe("Accept");
    expect(await missing.text()).toContain("/llms.txt");
  });

  it("keeps listing Markdown on the page of posts shown in HTML", () => {
    const data = {
      site: { name: "Field Notes", description: "A working journal" },
      posts: [{ title: "Second page", slug: "second", excerpt: "A short excerpt", published_at: 1700000000 }],
      page: 2,
      totalPosts: 21,
      listing: { kind: "index" },
    } as PublicIndexLoaderData;
    const markdown = listingMarkdown(data, "https://field.example.com");
    expect(markdown).toContain("# Field Notes\n> A working journal");
    expect(markdown).toContain("https://field.example.com/second.md");
    expect(markdown).toContain("A short excerpt");
    expect(markdown).toContain("[Newer](/)");
  });

  it("marks tenant HTML as negotiated and gives owner content the no-training default", () => {
    const headers = publicHtmlResponseHeaders({ effective_entitlement: { effective: true } } as never, { selfHosted: false } as never);
    expect(headers.vary).toBe("Accept");
    expect(headers["content-signal"]).toBe("ai-train=no, search=yes, ai-input=yes");
  });

  it("emits Organization, SoftwareApplication, WebSite and Blog JSON-LD", () => {
    const marketing = JSON.parse(marketingJsonLd(`${origin}/`));
    expect(marketing["@graph"].map((node: { "@type": string }) => node["@type"])).toEqual(["Organization", "SoftwareApplication"]);
    expect(marketing["@graph"][0].contactPoint.url).toBe(`${origin}/legal/support`);
    const tenant = JSON.parse(tenantBlogJsonLd("Field Notes", "https://field.example.com", "A working journal"));
    expect(tenant["@type"]).toEqual(["WebSite", "Blog"]);
    expect(tenant.publisher.name).toBe("Field Notes");
  });
});

describe("marketing discovery routes", () => {
  const context = (path: string) => ({
    request: new Request(`${origin}${path}`),
    params: { path: path.replace('/.well-known/', '') },
    locals: { publicEnv: { appUrl: app, publicBlogDomain: 'basedui.dev', selfHosted: false, generatedCards: false } },
  });

  it("serves each well-known document with its required media type", async () => {
    const { GET } = await import("../pages/.well-known/[...path]");
    for (const [path, mediaType] of [
      ['/.well-known/api-catalog', 'application/linkset+json'],
      ['/.well-known/mcp/server-card.json', 'application/json'],
      ['/.well-known/agent-skills/index.json', 'application/json'],
      ['/.well-known/agent-skills/vibecms-core/SKILL.md', 'text/markdown'],
    ]) {
      const response = await GET(context(path) as never) as Response;
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(mediaType);
    }
    const missing = await GET(context('/.well-known/unknown') as never) as Response;
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    const { GET: auth } = await import('../pages/auth.md');
    const authResponse = await auth(context('/auth.md') as never) as Response;
    expect(authResponse.headers.get('content-type')).toContain('text/markdown');
    expect(await authResponse.text()).toContain('Authorization: Bearer');
  });

  it("redirects aliases and the marketing OpenAPI URL", async () => {
    const { GET: openapi } = await import("../pages/openapi.json");
    const response = await openapi(context('/openapi.json') as never) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${app}/openapi.json`);
    const privacyResponse = marketingTrustRedirect('/privacy');
    const contactResponse = marketingTrustRedirect('/contact');
    expect(privacyResponse?.status).toBe(301);
    expect(privacyResponse?.headers.get('location')).toBe('/legal/privacy');
    expect(contactResponse?.status).toBe(301);
    expect(contactResponse?.headers.get('location')).toBe('/legal/support');
    expect(marketingTrustRedirect('/privacy-notes')).toBeNull();
  });
});

describe('public response negotiation', () => {
  it('converts an unknown Markdown request to a Markdown 404 and varies HTML', async () => {
    const markdown = markdownErrorForRequest(new Request(`${origin}/missing`, { headers: { accept: 'text/markdown' } }), new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } }));
    expect(markdown?.status).toBe(404);
    expect(markdown?.headers.get('content-type')).toContain('text/markdown');
    expect(markdown?.headers.get('vary')).toBe('Accept');
    expect((await markdown!.text()).length).toBeGreaterThan(20);
    const htmlHeaders = new Headers({ 'content-type': 'text/html' });
    varyAgentRepresentation(htmlHeaders);
    expect(htmlHeaders.get('vary')).toBe('Accept');
  });
});

describe('robots content signals', () => {
  it('allows search, AI input and training on the marketing host', async () => {
    const { env } = await import('cloudflare:workers');
    const { handleRobots } = await import('../server/public-feeds');
    const { parsePublicRuntimeEnv } = await import('../server/public-url');
    const response = await handleRobots(env.DB, new Request(`${origin}/robots.txt`, { headers: { host: 'basedui.dev' } }), parsePublicRuntimeEnv(env));
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
  });
});

describe("markdown 404 conversion", () => {
  const md = { accept: "text/markdown" };
  it("converts GET page 404s only", () => {
    const page = new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    expect(markdownErrorForRequest(new Request("https://x.test/nope", { headers: md }), page)?.headers.get("content-type")).toContain("text/markdown");
  });
  it("keeps JSON errors and non-GET responses as they are", () => {
    const json = Response.json({ error: "Not found" }, { status: 404 });
    expect(markdownErrorForRequest(new Request("https://x.test/.well-known/x", { headers: md }), json)).toBeNull();
    const page = new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    expect(markdownErrorForRequest(new Request("https://x.test/nope", { method: "POST", headers: md }), page)).toBeNull();
  });
});

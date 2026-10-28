// Agent discovery documents shared by the public and API Workers. Skill
// artifacts come from skills/*/SKILL.md via `pnpm gen:agent-skills`; every
// consumer (both .well-known routes, MCP/REST skills.*, the CLI through the
// index) derives the skill list from them, so a new skill folder needs no code.
import { agentPitch } from "./pitch";
import { skillArtifacts } from "./skills.generated";

export { agentPitch, skillArtifacts };

export type SkillName = keyof typeof skillArtifacts;
export const skillNames = Object.keys(skillArtifacts).sort() as SkillName[];

/** Own keys only, so `constructor` or `__proto__` never resolve to a skill. */
export function isSkillName(name: string): name is SkillName {
  return Object.hasOwn(skillArtifacts, name);
}

export const agentSkillsSchema = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

export function marketingDocs(appUrl: string): string {
  const app = appUrl.replace(/\/$/, "");
  return `## Docs\n\n- [Overview](/docs)\n- [API reference](/docs/api)\n- [Authentication](${app}/auth.md)\n- [OpenAPI](${app}/openapi.json)\n`;
}

export function marketingMarkdown(appUrl: string): string {
  return `${agentPitch({ appUrl })}${marketingDocs(appUrl)}`;
}

export function marketingLlmsTxt(appUrl: string, docsIndex: string): string {
  return `${agentPitch({ appUrl })}## Docs\n\n${docsIndex.replace(/^# Documentation\b/m, "### Documentation")}`;
}

export function apiCatalog(appUrl: string, marketingOrigin: string) {
  const app = appUrl.replace(/\/$/, "");
  return { linkset: [{ anchor: `${app}/api/v1`, "service-desc": [{ href: `${app}/openapi.json`, type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: `${marketingOrigin}/docs/api` }] }] };
}

export function mcpServerCard(appUrl: string, version: string) {
  const app = appUrl.replace(/\/$/, "");
  // authentication follows the SEP-1649 draft shape ({ required, schemes }).
  return { serverInfo: { name: "vibecms", version }, endpoint: `${app}/mcp`, transport: { type: "streamable-http", endpoint: `${app}/mcp` }, capabilities: { tools: {} }, authentication: { required: true, schemes: ["oauth2", "bearer"], instructions: `Apps that support MCP sign-in discover OAuth from ${app}/.well-known/oauth-protected-resource/mcp, and the person approves one blog and an access level. Other clients send a scoped agent key from Connect in the dashboard as Authorization: Bearer <key>. Details: ${app}/auth.md` } };
}

async function skillEntry(origin: string, name: SkillName) {
  const content: string = skillArtifacts[name];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const description = content.match(/^description:\s*(.+)$/m)?.[1] ?? name;
  return { name, type: "skill-md" as const, description, url: `${origin}/.well-known/agent-skills/${name}/SKILL.md`, digest: `sha256:${hex}` };
}

export async function agentSkillsIndex(origin: string) {
  return { $schema: agentSkillsSchema, skills: await Promise.all(skillNames.map((name) => skillEntry(origin, name))) };
}

/** One skill with its full SKILL.md, or null when no skill has that name. */
export async function agentSkill(origin: string, name: string) {
  if (!isSkillName(name)) return null;
  return { ...(await skillEntry(origin, name)), content: skillArtifacts[name] as string };
}

export function authMarkdown(appUrl: string, marketingOrigin: string): string {
  const app = appUrl.replace(/\/$/, "");
  return `# auth.md — vibecms agent access\n\nThis page is for agents connecting to vibecms on behalf of a person. There are two ways in, and both need the person who owns the blog to approve. There are no agent accounts: registering an OAuth client grants nothing by itself.\n\n## Sign in (MCP apps that support OAuth)\n\nConnect to ${app}/mcp over Streamable HTTP. A tool call without a token returns 401 with a \`WWW-Authenticate\` header that points to the protected resource metadata at ${app}/.well-known/oauth-protected-resource/mcp. The authorization server metadata is at ${app}/.well-known/oauth-authorization-server. vibecms supports the OAuth 2.1 authorization code flow with PKCE (S256) for public clients, client metadata documents from a short list of reviewed hosts, and dynamic client registration at ${app}/oauth/register. The person signs in at ${app}, picks one blog and an access level, and approves. Access tokens last one hour and work only for ${app}/mcp; refresh tokens rotate. The person can disconnect the app under Connect at any time.\n\n## Agent key (any MCP client, REST and the CLI)\n\nThe person signs in at ${app}, opens Connect in the dashboard, and creates an agent key. New keys are scoped to drafts by default; the person may separately enable publishing. Send the key with every MCP or REST request as \`Authorization: Bearer <key>\`. Connect to ${app}/mcp over Streamable HTTP, or use the REST API at ${app}/api/v1. Keep the key private and ask the person to revoke it under Connect if it is exposed.\n\nRead the [API documentation](${marketingOrigin}/docs/api), [authentication guide](${marketingOrigin}/docs/api/authentication), and [OpenAPI document](${app}/openapi.json).\n`;
}

export function marketingHomeLinks(origin: string, appUrl: string): string {
  const app = appUrl.replace(/\/$/, "");
  return [`<${origin}/llms.txt>; rel="describedby"`, `<${origin}/sitemap.xml>; rel="sitemap"`, `<${origin}/.well-known/api-catalog>; rel="api-catalog"`, `<${origin}/.well-known/mcp/server-card.json>; rel="service-desc"`, `<${app}/openapi.json>; rel="service-desc"`].join(", ");
}

export function tenantHomeLinks(origin: string, basePath = ""): string {
  const base = `${origin}${basePath}`;
  return [`<${base}/llms.txt>; rel="describedby"`, `<${base}/sitemap.xml>; rel="sitemap"`, `<${base}/feed.xml>; rel="alternate"; type="application/rss+xml"`].join(", ");
}

export function markdownNotFound(): Response {
  return new Response("# Not found\n\nThe requested page was not found. [Go home](/) or read [llms.txt](/llms.txt).\n", { status: 404, headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept", "cache-control": "no-store" } });
}

/**
 * Swap a page 404 for a Markdown one when an agent asked for Markdown. Only
 * GET/HEAD page responses: JSON errors (API, discovery documents) and other
 * methods keep their own body and headers.
 */
export function markdownErrorForRequest(request: Request, response: Response): Response | null {
  if (response.status !== 404) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!request.headers.get("accept")?.includes("text/markdown")) return null;
  const type = response.headers.get("content-type") ?? "";
  if (type && !/^text\/(?:html|plain)/i.test(type)) return null;
  return markdownNotFound();
}

export function varyAgentRepresentation(headers: Headers): void {
  if (/^(?:text\/html|text\/markdown)/i.test(headers.get("content-type") || "")) headers.set("Vary", "Accept");
}

export function marketingTrustRedirect(pathname: string): Response | null {
  const location = pathname === "/privacy" ? "/legal/privacy" : pathname === "/contact" ? "/legal/support" : null;
  return location ? new Response(null, { status: 301, headers: { location } }) : null;
}

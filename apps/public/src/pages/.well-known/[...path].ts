import type { APIRoute } from "astro";
import { apiCatalog, mcpServerCard, agentSkillsIndex, skillArtifacts } from "../../lib/agent-discovery";
import { isMarketingHost } from "../../server/public-blog";
import { publicRuntimeEnv } from "../../server/runtime";
import { publicOrigin } from "../../server/public-url";
import rootPackage from "../../../../../package.json";

export const GET: APIRoute = async (context) => {
  const { request, params } = context;
  const env = publicRuntimeEnv(context);
  if (env.selfHosted || !isMarketingHost(request, env)) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  const origin = publicOrigin(request.url);
  const path = params.path;
  if (path === "api-catalog") return new Response(JSON.stringify(apiCatalog(env.appUrl, origin)), { headers: { "content-type": "application/linkset+json; charset=utf-8" } });
  if (path === "mcp/server-card.json") return Response.json(mcpServerCard(env.appUrl, rootPackage.version));
  if (path === "agent-skills/index.json") return Response.json(await agentSkillsIndex(origin));
  const match = /^agent-skills\/(vibecms-core|vibecms-writing)\/SKILL\.md$/.exec(path || "");
  if (match) return new Response(skillArtifacts[match[1] as keyof typeof skillArtifacts], { headers: { "content-type": "text/markdown; charset=utf-8" } });
  return Response.json({ error: "Not found" }, { status: 404 });
};

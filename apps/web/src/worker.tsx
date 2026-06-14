import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { AppError, RateLimitError, can } from "@vc/core";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { Activity } from "@/app/pages/activity";
import { AuthPage } from "@/app/pages/auth";
import { BillingRequired } from "@/app/pages/billing-required";
import { Dashboard } from "@/app/pages/dashboard";
import { HostHome } from "@/app/pages/host-home";
import { Media } from "@/app/pages/media";
import { EditPost, NewPost } from "@/app/pages/post-editor";
import { Posts } from "@/app/pages/posts";
import { Setup } from "@/app/pages/setup";
import { Settings } from "@/app/pages/settings";
import { TokenCreated } from "@/app/pages/token-created";
import { Connect } from "@/app/pages/connect";
import { auth } from "@/lib/auth";
import { PublicIndexBySlug, PublicPost, PublicPostBySlug } from "@/server/public-blog";
import { authenticateBearerToken, createApiKeyFromRequest, revokeApiKey } from "@/server/api-keys";
import { apiRateLimitHeaders, enforceApiBudget } from "@/server/usage";
import { createCheckoutSession, createPortalSession, handlePolarWebhook } from "@/server/billing";
import { serveAsset, uploadAssetFromRequest } from "@/server/media";
import { handleMcpRequest } from "@/server/mcp";
import { handleFeed, handleLlmsTxt, handleLlmsTxtBySlug, handleRobots, handleSitemap } from "@/server/public-feeds";
import { handleExport } from "@/server/export";
import { rejectCrossOriginBrowserPost } from "@/server/csrf";
import {
  archivePostFromRequest,
  createPostFromRequest,
  getPosts,
  publishPostFromRequest,
  updatePostFromRequest,
} from "@/server/cms";
import { completeSiteSetup, ensureOnboarding, getSiteSetup, type AppUserContext } from "@/server/onboarding";
import { checkOtpSendBudget } from "@/server/auth-rate-limit";
import { env } from "cloudflare:workers";

export type AppContext = { authUrl?: string; googleEnabled?: boolean; app?: AppUserContext };

const requireUser = ({ ctx }: { ctx: AppContext }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
};

const requireSetup = async ({ ctx, request }: { ctx: AppContext; request: Request }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  if (new URL(request.url).pathname === "/app/setup") return;
  const setup = await getSiteSetup(ctx.app);
  if (!setup.isComplete) return new Response(null, { status: 302, headers: { Location: "/app/setup" } });
};

const requireApp = (ctx: AppContext) => {
  if (!ctx.app) throw new Response(null, { status: 401 });
  return ctx.app;
};

const TOKEN_FLASH_COOKIE = "vc_token_flash";

function redirect(to: string, headers?: HeadersInit) {
  return new Response(null, { status: 303, headers: { Location: to, ...headers } });
}

function tokenFlashCookieValue(token: string, name: string) {
  return encodeURIComponent(JSON.stringify({ token, name }));
}

function tokenFlashCookieHeader(token: string, name: string) {
  const secure = env.APP_ENV === "production" ? "; Secure" : "";
  return `${TOKEN_FLASH_COOKIE}=${tokenFlashCookieValue(token, name)}; HttpOnly; SameSite=Lax${secure}; Path=/app; Max-Age=120`;
}

function clearTokenFlashCookieHeader() {
  const secure = env.APP_ENV === "production" ? "; Secure" : "";
  return `${TOKEN_FLASH_COOKIE}=; HttpOnly; SameSite=Lax${secure}; Path=/app; Max-Age=0`;
}

function parseTokenFlashCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${TOKEN_FLASH_COOKIE}=`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match.slice(TOKEN_FLASH_COOKIE.length + 1))) as { token?: unknown; name?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.name !== "string") return null;
    return { token: parsed.token, name: parsed.name };
  } catch {
    return null;
  }
}

function apiError(error: unknown) {
  if (error instanceof AppError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    const safeCode = ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "BILLING_REQUIRED", "RATE_LIMIT"].includes(error.code) ? error.code : "INTERNAL_ERROR";
    return Response.json({ error: safeCode }, { status, headers: error instanceof RateLimitError ? apiRateLimitHeaders(error) : undefined });
  }
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

function postStatusParam(value: string | null) {
  return value === "draft" || value === "published" || value === "archived" ? value : undefined;
}

function boundedIntegerParam(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
function forceQuotaForSmoke(request: Request) {
  return env.APP_ENV !== "production" && request.headers.get("x-vibecms-quota-smoke") === "1";
}



export default defineApp([
  setCommonHeaders(),
  ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (request.method !== "POST") return;
    if (pathname !== "/api/onboarding/ensure" && !pathname.startsWith("/app/")) return;
    return rejectCrossOriginBrowserPost(request);
  },
  async ({ request }) => {
    if (request.method !== "POST") return;
    if (new URL(request.url).pathname !== "/api/auth/email-otp/send-verification-otp") return;
    // Only meter requests Better Auth will actually accept (and therefore send an email for).
    // A request it would reject - wrong content type or a malformed address - must not debit a
    // victim's budget, or an attacker could lock them out without any code ever being sent.
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return;
    let email = "";
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      if (typeof body.email === "string") email = body.email;
    } catch {
      return; // malformed body - let Better Auth reject it
    }
    // Skip anything that is not a plausible address (surrounding whitespace included) so only
    // sendable requests count against the cap.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const decision = await checkOtpSendBudget(email);
    if (!decision.allowed) {
      return Response.json(
        { error: "RATE_LIMIT" },
        { status: 429, headers: { "retry-after": String(decision.retryAfter) } },
      );
    }
  },
  async ({ ctx, request }) => {
    ctx.authUrl = env.BETTER_AUTH_URL;
    ctx.googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      ctx.app = await ensureOnboarding({ id: session.user.id, name: session.user.name, email: session.user.email });
    }
  },
  route("/api/auth/*", ({ request }) => auth.handler(request)),
  route("/mcp", ({ request }) => handleMcpRequest(request)),
  route("/polar/webhook", { post: ({ request }) => handlePolarWebhook(request) }),
  route("/media-assets/:assetId", ({ params }) => serveAsset(params.assetId)),
  route("/api/onboarding/ensure", {
    post: async ({ ctx }) => {
      const app = requireApp(ctx);
      await ensureOnboarding(app.user);
      return Response.json({ ok: true });
    },
  }),
  route("/api/posts", {
    get: async ({ request }) => {
      const authResult = await authenticateBearerToken(request);
      if (!authResult) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
      if (!can(authResult.actor, "posts:read")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
      try {
        await enforceApiBudget({ workspaceId: authResult.workspaceId, siteId: authResult.siteId, tokenId: authResult.tokenId, kind: "read", force: forceQuotaForSmoke(request) });
        const url = new URL(request.url);
        const limit = boundedIntegerParam(url.searchParams.get("limit"), 20, 1, 100);
        const offset = boundedIntegerParam(url.searchParams.get("offset"), 0, 0, 10_000);
        const posts = await getPosts(
          { user: { id: "api", name: authResult.actor.name, email: "api" }, workspaceId: authResult.workspaceId, siteId: authResult.siteId, actor: authResult.actor },
          postStatusParam(url.searchParams.get("status")),
          url.searchParams.get("search") || undefined,
          limit,
          offset,
        );
        return Response.json({ posts, pagination: { limit, offset, count: posts.length } });
      } catch (error) {
        return apiError(error);
      }
    },
  }),
  route("/feed.xml", ({ request }) => handleFeed(request)),
  route("/sitemap.xml", ({ request }) => handleSitemap(request)),
  route("/robots.txt", ({ request }) => handleRobots(request)),
  route("/llms.txt", ({ request }) => handleLlmsTxt(request)),
  route("/blog/:siteSlug/llms.txt", ({ request, params }) => handleLlmsTxtBySlug(request, params.siteSlug)),
  route("/app/export.json", { get: ({ ctx }) => handleExport(requireApp(ctx)) }),
  render(Document, [
    route("/", HostHome),
    route("/login", AuthPage),
    route("/app/setup", [requireUser, Setup]),
    route("/app/setup/complete", { post: ({ ctx, request }) => completeSiteSetup(requireApp(ctx), request) }),
    route("/app/billing", [requireSetup, BillingRequired]),
    route("/app", [requireSetup, Dashboard]),
    route("/app/posts", [requireSetup, Posts]),
    route("/app/posts/new", [requireSetup, NewPost]),
    route("/app/posts/create", { post: ({ ctx, request }) => createPostFromRequest(requireApp(ctx), request) }),
    route("/app/posts/:postId/edit", [requireSetup, EditPost]),
    route("/app/posts/:postId/update", { post: ({ ctx, request, params }) => updatePostFromRequest(requireApp(ctx), request, params.postId) }),
    route("/app/posts/:postId/publish", { post: ({ ctx, request, params }) => publishPostFromRequest(requireApp(ctx), params.postId, request) }),
    route("/app/posts/:postId/archive", { post: ({ ctx, request, params }) => archivePostFromRequest(requireApp(ctx), params.postId, request) }),
    route("/app/media", [requireSetup, Media]),
    route("/app/media/upload", { post: ({ ctx, request }) => uploadAssetFromRequest(requireApp(ctx), request) }),
    route("/app/activity", [requireSetup, Activity]),
    route("/app/billing/checkout", { post: ({ ctx, request }) => createCheckoutSession(requireApp(ctx), request) }),
    route("/app/billing/portal", { post: ({ ctx }) => createPortalSession(requireApp(ctx)) }),
    route("/app/settings", [requireSetup, Settings]),
    route("/app/connect", [requireSetup, ({ ctx, request, response }) => {
      const app = requireApp(ctx);
      const flash = parseTokenFlashCookie(request);
      if (flash) response.headers.append("Set-Cookie", clearTokenFlashCookieHeader());
      return <Connect app={app} request={request} mcpUrl={`${env.APP_URL}/mcp`} token={flash?.token} tokenName={flash?.name} />;
    }]),
    route("/app/settings/api-keys/create", {
      post: async ({ ctx, request }) => {
        const flow = new URL(request.url).searchParams.get("flow") === "connect" ? "connect" : "settings";
        const base = flow === "connect" ? "/app/connect" : "/app/settings";
        try {
          const created = await createApiKeyFromRequest(requireApp(ctx), request);
          const dest = flow === "connect" ? "/app/connect" : "/app/settings/token-created";
          return redirect(dest, { "Set-Cookie": tokenFlashCookieHeader(created.token, created.name) });
        } catch (error) {
          if (error instanceof Response) throw error;
          if (error instanceof AppError && error.code === "CONFLICT") return redirect(`${base}?error=token_limit`);
          if (error instanceof AppError && error.code === "FORBIDDEN") return redirect(`${base}?error=owner_required`);
          return redirect(`${base}?error=unknown`);
        }
      },
    }),
    route("/app/settings/token-created", [requireSetup, ({ ctx, request, response }) => {
      const flash = parseTokenFlashCookie(request);
      if (!flash) return redirect("/app/settings?error=token_expired");
      // Enforce the one-time reveal server-side: clear the flash cookie on this
      // same response so a reload (even with JS disabled) cannot show it again.
      response.headers.append("Set-Cookie", clearTokenFlashCookieHeader());
      return <TokenCreated token={flash.token} name={flash.name} mcpUrl={`${env.APP_URL}/mcp`} app={requireApp(ctx)} />;
    }]),
    route("/app/settings/token-created/clear", { post: () => new Response(null, { status: 204, headers: { "Set-Cookie": clearTokenFlashCookieHeader() } }) }),
    route("/app/settings/api-keys/:keyId/revoke", { post: async ({ ctx, params }) => {
      try {
        return await revokeApiKey(requireApp(ctx), params.keyId);
      } catch (error) {
        if (error instanceof Response) throw error;
        if (error instanceof AppError && error.code === "FORBIDDEN") return redirect("/app/settings?error=owner_required");
        return redirect("/app/settings?error=unknown");
      }
    } }),
    route("/blog/:siteSlug", PublicIndexBySlug),
    route("/blog/:siteSlug/:postSlug", PublicPostBySlug),
    route("/:slug", PublicPost),
  ]),
]);

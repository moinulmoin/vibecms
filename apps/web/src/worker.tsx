import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { can } from "@vc/core";

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
import { auth } from "@/lib/auth";
import { PublicPost } from "@/server/public-blog";
import { authenticateBearerToken, createApiKeyFromRequest, revokeApiKey } from "@/server/api-keys";
import { createCheckoutSession, createPortalSession, getBillingStatus, handlePolarWebhook } from "@/server/billing";
import { serveAsset, uploadAssetFromRequest } from "@/server/media";
import { handleMcpRequest } from "@/server/mcp";
import {
  archivePostFromRequest,
  createPostFromRequest,
  getPosts,
  publishPostFromRequest,
  updatePostFromRequest,
} from "@/server/cms";
import { completeSiteSetup, ensureOnboarding, getSiteSetup, type AppUserContext } from "@/server/onboarding";
import { env } from "cloudflare:workers";

export type AppContext = { authUrl?: string; app?: AppUserContext };

const requireUser = ({ ctx }: { ctx: AppContext }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
};

const requireSetup = async ({ ctx, request }: { ctx: AppContext; request: Request }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  if (new URL(request.url).pathname === "/app/setup") return;
  const setup = await getSiteSetup(ctx.app);
  if (!setup.isComplete) return new Response(null, { status: 302, headers: { Location: "/app/setup" } });
};

const requireBilling = async ({ ctx, request }: { ctx: AppContext; request: Request }) => {
  const setupResponse = await requireSetup({ ctx, request });
  if (setupResponse) return setupResponse;
  const pathname = new URL(request.url).pathname;
  if (pathname === "/app/billing" || pathname === "/app/billing/checkout") return;
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const billingStatus = await getBillingStatus(ctx.app.workspaceId);
  if (billingStatus !== "trialing" && billingStatus !== "active") return new Response(null, { status: 302, headers: { Location: "/app/billing" } });
};

const requireApp = (ctx: AppContext) => {
  if (!ctx.app) throw new Response(null, { status: 401 });
  return ctx.app;
};

const requireBillableApp = async (ctx: AppContext) => {
  const app = requireApp(ctx);
  const billingStatus = await getBillingStatus(app.workspaceId);
  if (billingStatus !== "trialing" && billingStatus !== "active") throw new Response(null, { status: 303, headers: { Location: "/app/billing" } });
  return app;
};

export default defineApp([
  setCommonHeaders(),
  async ({ ctx, request }) => {
    ctx.authUrl = env.BETTER_AUTH_URL;
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
      if (!authResult) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (!can(authResult.actor, "posts:read")) return Response.json({ error: "Forbidden" }, { status: 403 });
      const posts = await getPosts({ user: { id: "api", name: authResult.actor.name, email: "api" }, workspaceId: "api", siteId: authResult.siteId, actor: authResult.actor });
      return Response.json({ posts });
    },
  }),
  render(Document, [
    route("/", HostHome),
    route("/login", AuthPage),
    route("/app/setup", [requireUser, Setup]),
    route("/app/setup/complete", { post: ({ ctx, request }) => completeSiteSetup(requireApp(ctx), request) }),
    route("/app/billing", [requireSetup, BillingRequired]),
    route("/app", [requireBilling, Dashboard]),
    route("/app/posts", [requireBilling, Posts]),
    route("/app/posts/new", [requireBilling, NewPost]),
    route("/app/posts/create", { post: async ({ ctx, request }) => createPostFromRequest(await requireBillableApp(ctx), request) }),
    route("/app/posts/:postId/edit", [requireBilling, EditPost]),
    route("/app/posts/:postId/update", { post: async ({ ctx, request, params }) => updatePostFromRequest(await requireBillableApp(ctx), request, params.postId) }),
    route("/app/posts/:postId/publish", { post: async ({ ctx, params }) => publishPostFromRequest(await requireBillableApp(ctx), params.postId) }),
    route("/app/posts/:postId/archive", { post: async ({ ctx, params }) => archivePostFromRequest(await requireBillableApp(ctx), params.postId) }),
    route("/app/media", [requireBilling, Media]),
    route("/app/media/upload", { post: async ({ ctx, request }) => uploadAssetFromRequest(await requireBillableApp(ctx), request) }),
    route("/app/activity", [requireBilling, Activity]),
    route("/app/billing/checkout", { post: ({ ctx, request }) => createCheckoutSession(requireApp(ctx), request) }),
    route("/app/billing/portal", { post: ({ ctx }) => createPortalSession(requireApp(ctx)) }),
    route("/app/settings", [requireBilling, Settings]),
    route("/app/settings/api-keys/create", {
      post: async ({ ctx, request }) => {
        const created = await createApiKeyFromRequest(await requireBillableApp(ctx), request);
        return <TokenCreated token={created.token} name={created.name} />;
      },
    }),
    route("/app/settings/api-keys/:keyId/revoke", { post: async ({ ctx, params }) => revokeApiKey(await requireBillableApp(ctx), params.keyId) }),
    route("/:slug", PublicPost),
  ]),
]);

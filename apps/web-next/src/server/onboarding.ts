import type { Actor } from "@vc/core";
import { env } from "cloudflare:workers";

type AuthSessionUser = { id: string; name: string; email: string };

export type AppUserContext = {
  user: AuthSessionUser;
  siteId: string;
  workspaceId: string;
  actor: Actor;
};

export function publicBlogBaseDomain() {
  const raw = env.PUBLIC_BLOG_DOMAIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1") return null;
    return hostname;
  } catch {
    return null;
  }
}

export function defaultHostname(slug: string) {
  return `${slug}.${publicBlogBaseDomain() ?? "localhost"}`;
}

export function isLocalDefaultHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost");
}
import type { PublicRuntimeEnv } from "../env";

export function publicBlogBaseDomain(env: PublicRuntimeEnv) {
  return env.publicBlogDomain;
}

export function defaultHostname(slug: string, env: PublicRuntimeEnv) {
  return `${slug}.${publicBlogBaseDomain(env) ?? "localhost"}`;
}

export function isLocalDefaultHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost");
}

export function publicUrlForHostname(hostname: string | null) {
  if (!hostname) return null;
  return `${isLocalDefaultHostname(hostname) ? "http" : "https"}://${hostname}`;
}

export function parsePublicRuntimeEnv(raw: Env): PublicRuntimeEnv {
  const domainRaw = raw.PUBLIC_BLOG_DOMAIN?.trim();
  let publicBlogDomain: string | null = null;
  if (domainRaw) {
    try {
      const url = new URL(domainRaw.includes("://") ? domainRaw : `https://${domainRaw}`);
      const hostname = url.hostname.toLowerCase();
      if (hostname && hostname !== "localhost" && !hostname.endsWith(".localhost") && hostname !== "127.0.0.1") {
        publicBlogDomain = hostname;
      }
    } catch {
      publicBlogDomain = null;
    }
  }
  return {
    appUrl: raw.APP_URL,
    publicBlogDomain,
    selfHosted: String(raw.SELF_HOSTED) === "true",
  };
}
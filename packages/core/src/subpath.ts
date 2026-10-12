/**
 * Subpath-hosted blog helpers (plans/022 phase 3): the proxy target URL and
 * ready-to-paste customer-side proxy snippets. Pure + dependency-free so the
 * API (setup view) and the public worker (health fingerprint) share them.
 */

/**
 * The proxy id works like a credential (whoever knows it can call the
 * ingress directly), so the health probe never echoes it. The setup check
 * compares this short SHA-256 fingerprint against the one it computes.
 */
export async function proxyFingerprint(proxyId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proxyId));
  return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where the customer's proxy sends `https://<hostname><basePath>/*` traffic. */
export function subpathProxyTarget(input: { slug: string; publicBlogDomain: string; proxyId: string }): string {
  return `https://${input.slug}.${input.publicBlogDomain}/_vc/p/${input.proxyId}`;
}

/** Ingress paths carry the (rotatable) proxy credential; strip the id out of
 *  anything headed for error messages, stored check results, or logs. */
export function redactProxyLinks(text: string): string {
  return text.replace(/\/_vc\/p\/[^/?#\s"']+/g, "/_vc/p/\u2026");
}

export type SubpathSnippets = {
  cloudflareWorker: { code: string; route: string };
  vercel: string;
  nextjs: string;
  netlify: string;
  nginx: string;
  caddy: string;
};

/**
 * Copy-paste proxy config for the customer's platform. Every snippet forwards
 * the request path and query and never forwards the customer's Host header —
 * vibecms routes by its own hostname.
 */
export function subpathSnippets(input: { hostname: string; basePath: string; proxyTarget: string }): SubpathSnippets {
  const { hostname, basePath, proxyTarget } = input;
  const upstreamHost = new URL(proxyTarget).host;

  const cloudflareWorker = {
    code: `// Workers Free covers 100k requests/day (then Error 1027); Workers Paid is $5/mo for busy blogs.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // The route matches ${basePath}* but only ${basePath} and its /-descendants are the blog;
    // everything else (e.g. ${basePath}x) belongs to this site's own origin.
    if (url.pathname !== ${JSON.stringify(basePath)} && !url.pathname.startsWith(${JSON.stringify(basePath + "/")})) {
      return fetch(request);
    }
    const rest = url.pathname.slice(${JSON.stringify(basePath)}.length) || "/";
    return fetch(new Request(${JSON.stringify(proxyTarget)} + rest + url.search, request));
  },
};`,
    route: `${hostname}${basePath}*`,
  };

  const vercel = JSON.stringify(
    {
      rewrites: [
        { source: basePath, destination: `${proxyTarget}/` },
        { source: `${basePath}/:path*`, destination: `${proxyTarget}/:path*` },
      ],
    },
    null,
    2,
  );

  const nextjs = `// next.config.js
module.exports = {
  async rewrites() {
    return [
      { source: ${JSON.stringify(basePath)}, destination: ${JSON.stringify(`${proxyTarget}/`)} },
      { source: ${JSON.stringify(`${basePath}/:path*`)}, destination: ${JSON.stringify(`${proxyTarget}/:path*`)} },
    ];
  },
};`;

  const netlify = `# public/_redirects (or _redirects at the site root)
${basePath}  ${proxyTarget}/  200!
${basePath}/*  ${proxyTarget}/:splat  200!`;

  const nginx = `location = ${basePath} {
  proxy_pass ${proxyTarget}/;
  proxy_set_header Host ${upstreamHost};
  proxy_ssl_server_name on;
}
location ^~ ${basePath}/ {
  proxy_pass ${proxyTarget}/;
  proxy_set_header Host ${upstreamHost};
  proxy_ssl_server_name on;
}`;

  const caddy = `@vcblog path ${basePath} ${basePath}/*
handle @vcblog {
  uri strip_prefix ${basePath}
  rewrite * ${new URL(proxyTarget).pathname}{uri}
  reverse_proxy https://${upstreamHost} {
    header_up Host ${upstreamHost}
  }
}`;

  return { cloudflareWorker, vercel, nextjs, netlify, nginx, caddy };
}

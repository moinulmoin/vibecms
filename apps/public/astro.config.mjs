import { defineConfig, sessionDrivers } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Astro sessions are unused (Better Auth owns app sessions on the API Worker).
  // Override the Cloudflare adapter default so hosted/dev/self-host do not require a SESSION KV namespace.
  session: {
    driver: sessionDrivers.lruCache(),
  },
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare-binding",
    persistState: { path: "../../.wrangler/state" },
  }),
  integrations: [react()],
  markdown: {
    syntaxHighlight: false,
  },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
      ],
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
    },
  },
  cache: {
    provider: cacheCloudflare(),
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      dedupe: ["react", "react-dom"],
      // No client:* islands remain; keep renderer slot but drop browser React.
      alias: [
        {
          find: "@astrojs/react/client.js",
          replacement: new URL("./src/lib/empty-react-client.js", import.meta.url).pathname,
        },
      ],
    },
    server: {
      allowedHosts: [".basedui.dev"],
    },
    ssr: {
      external: ["node:async_hooks"],
    },
  },
});
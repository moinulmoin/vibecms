import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
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
    server: {
      allowedHosts: [".basedui.dev"],
    },
    ssr: {
      external: ["node:async_hooks"],
    },
  },
});
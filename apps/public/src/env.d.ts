/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

import type { PublicLocation } from "./server/public-location";

export type PublicRuntimeEnv = {
  appUrl: string;
  publicBlogDomain: string | null;
  selfHosted: boolean;
  generatedCards: boolean;
  /** Valid `INDEXNOW_KEY` setting; null/absent = IndexNow off, no key file served. */
  indexNowKey?: string | null;
};

declare global {
  interface Env {
    /** Optional IndexNow key (Worker setting); see docs/deploy.md. */
    INDEXNOW_KEY?: string;
  }
  namespace App {
    interface Locals {
      /** Cloudflare execution context (waitUntil) from the Astro adapter. */
      cfContext?: ExecutionContext;
      runtime: {
        env: Env;
        cf?: IncomingRequestCfProperties;
        caches?: CacheStorage;
        ctx?: { waitUntil: (promise: Promise<unknown>) => void };
      };
      publicEnv?: PublicRuntimeEnv;
      /** Customer-facing origin/basePath/assetOrigin for this request (plan 022). */
      publicLocation?: PublicLocation;
      /** Blog-relative path after proxy-ingress stripping ("/…"). */
      publicPath?: string;
      /** Origin permitted for this rendered site's external signup form. */
      newsletterFormOrigin?: string;
      /** Set after the first middleware pass records an agent_fetch point. */
      agentFetchRecorded?: boolean;
    }
  }
}

export {};

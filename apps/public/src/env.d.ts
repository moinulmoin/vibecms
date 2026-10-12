/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

import type { PublicLocation } from "./server/public-location";

export type PublicRuntimeEnv = {
  appUrl: string;
  publicBlogDomain: string | null;
  selfHosted: boolean;
  generatedCards: boolean;
};

declare global {
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
      /** Set after the first middleware pass records an agent_fetch point. */
      agentFetchRecorded?: boolean;
    }
  }
}

export {};

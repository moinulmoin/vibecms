/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

export type PublicRuntimeEnv = {
  appUrl: string;
  publicBlogDomain: string | null;
  selfHosted: boolean;
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
    }
  }
}

export {};

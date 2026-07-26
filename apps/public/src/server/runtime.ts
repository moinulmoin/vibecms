import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import type { PublicRuntimeEnv } from "../env";
import { parsePublicRuntimeEnv } from "./public-url";

export function workerEnv(_context: APIContext): Env {
  return env;
}

export function publicRuntimeEnv(context: APIContext): PublicRuntimeEnv {
  if (context.locals.publicEnv) return context.locals.publicEnv;
  const parsed = parsePublicRuntimeEnv(workerEnv(context));
  context.locals.publicEnv = parsed;
  return parsed;
}

export function publicDb(context: APIContext): D1Database {
  return workerEnv(context).DB;
}

export function publicAssetsBucket(context: APIContext): R2Bucket {
  return workerEnv(context).ASSETS_BUCKET;
}

export function publicImages(context: APIContext): ImagesBinding | undefined {
  // Self-host root wrangler may omit IMAGES during transition; callers fall back to originals.
  const bindings = workerEnv(context) as { IMAGES?: ImagesBinding };
  return bindings.IMAGES;
}

export function apiBinding(context: APIContext): Fetcher {
  return workerEnv(context).API;
}
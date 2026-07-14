import type { PublicRuntimeEnv } from "../env";
import { resolveCanonicalRedirect, type CanonicalHostContext } from "./canonical-host";

export function canonicalHostRedirect(request: Request, env: PublicRuntimeEnv): Response | undefined {
  let appHost: string;
  try {
    appHost = new URL(env.appUrl).hostname;
  } catch {
    return undefined;
  }
  const ctx: CanonicalHostContext = { appHost };
  return resolveCanonicalRedirect(request, ctx);
}
import { listPosts, type Post } from "@vc/core";
import { createD1PostRepository } from "@vc/db";
import { env } from "cloudflare:workers";
import type { AppUserContext } from "./onboarding";

function repository() {
  return createD1PostRepository(env.DB);
}

export async function getPosts(
  app: AppUserContext,
  status?: Post["status"],
  search?: string,
  limit = 100,
  offset = 0,
) {
  return listPosts(repository(), app.actor, { siteId: app.siteId, status, search, limit, offset });
}
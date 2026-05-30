import { z } from "zod";

export const scope = z.enum([
  "sites:read",
  "posts:read",
  "posts:create",
  "posts:update",
  "posts:publish",
  "posts:archive",
  "assets:write",
  "activity:read",
]);

export const createApiKeyInput = z.object({
  siteId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  actorName: z.string().trim().min(1).max(80),
  scopes: z.array(scope).min(1).max(8),
}).strict();

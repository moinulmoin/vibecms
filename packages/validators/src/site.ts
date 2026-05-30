import { z } from "zod";

export const createSiteInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(300).optional(),
}).strict();

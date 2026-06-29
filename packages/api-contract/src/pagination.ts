import { z } from "zod";

export const paginationMetaSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  count: z.number().int(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
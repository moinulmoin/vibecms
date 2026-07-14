import { z } from 'zod'

export const mutationResultSchema = z.object({
  kind: z.enum(['ok', 'error']),
  code: z.string(),
  postId: z.string().optional(),
  versionNumber: z.number().optional(),
})

export type ParsedMutationResult = z.infer<typeof mutationResultSchema>

export function parseMutationResultJson(body: unknown): ParsedMutationResult {
  return mutationResultSchema.parse(body)
}
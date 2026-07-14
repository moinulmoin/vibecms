import { z } from 'zod'
import { assetDtoSchema, postStatusSchema } from './dto'

export const dashboardMutationResultSchema = z.object({
  kind: z.enum(['ok', 'error']),
  code: z.string(),
  postId: z.string().optional(),
  versionNumber: z.number().optional(),
})

export const dashboardPostSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  coverAssetId: z.string().nullable(),
  status: postStatusSchema,
  publishedAt: z.number().nullable(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  versionNumber: z.number().nullable(),
})

export const dashboardContextSchema = z.object({
  googleEnabled: z.boolean(),
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    })
    .nullable(),
  app: z
    .object({
      user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      siteId: z.string(),
      workspaceId: z.string(),
      actor: z.object({
        type: z.literal('human'),
        id: z.string(),
        name: z.string(),
        role: z.enum(['owner', 'editor', 'viewer']),
      }),
    })
    .nullable(),
  siteSetupComplete: z.boolean(),
  siteDisplayName: z.string().nullable(),
})

export const dashboardMediaPageSchema = z.object({
  assets: z.array(assetDtoSchema),
})

export const dashboardActivityPageSchema = z.object({
  events: z.array(
    z.object({
      action: z.string(),
      summary: z.string(),
      actor_type: z.string(),
      actor_name: z.string(),
      created_at: z.number(),
    }),
  ),
  hasMore: z.boolean(),
})

export const dashboardPostsPageSchema = z.object({
  posts: z.array(dashboardPostSummarySchema),
  hasMore: z.boolean(),
})

export type DashboardMutationResult = z.infer<typeof dashboardMutationResultSchema>
export type DashboardPostSummaryDto = z.infer<typeof dashboardPostSummarySchema>
export type DashboardContextDto = z.infer<typeof dashboardContextSchema>
import { z } from 'zod'

const apiUsageStatusSchema = z.object({
  metric: z.string(),
  period: z.string(),
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  resetsAt: z.number(),
})

export const appRouterContextSchema = z.object({
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
        role: z.enum(['owner', 'editor']),
      }),
    })
    .nullable(),
  siteSetupComplete: z.boolean(),
  siteDisplayName: z.string().nullable(),
})

export const mutationResultSchema = z.object({
  kind: z.enum(['ok', 'error']),
  code: z.string(),
  postId: z.string().optional(),
  versionNumber: z.number().optional(),
})

const billingStatusSchema = z.enum(['active', 'past_due', 'canceled', 'unpaid', 'none'])

export const dashboardDataSchema = z.object({
  site: z.object({ name: z.string(), slug: z.string() }).nullable(),
  publicUrl: z.string().nullable(),
  publicUrlLocal: z.boolean(),
  billing: z.object({ status: billingStatusSchema }),
  apiUsage: z.object({
    enforced: z.boolean(),
    calls: z.object({
      minute: apiUsageStatusSchema,
      day: apiUsageStatusSchema,
      month: apiUsageStatusSchema,
    }),
    writes: z.object({
      day: apiUsageStatusSchema,
      month: apiUsageStatusSchema,
    }),
  }),
  counts: z.object({
    published: z.number(),
    draft: z.number(),
    archived: z.number(),
  }),
  media: z.object({ bytes: z.number(), count: z.number() }),
  tokenCount: z.number(),
  versionCount: z.number(),
  recentPosts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      status: z.string(),
      updatedAt: z.number(),
      publishedAt: z.number().nullable(),
    }),
  ),
  recentActivity: z.array(
    z.object({
      action: z.string(),
      summary: z.string(),
      actor_name: z.string(),
      created_at: z.number(),
    }),
  ),
})

export const settingsPageDataSchema = z.object({
  site: z.object({
    name: z.string(),
    description: z.string(),
    defaultSeoTitle: z.string(),
    defaultSeoDescription: z.string(),
    theme: z.string(),
    slug: z.string(),
    themeAccent: z.string(),
    themeFont: z.string(),
    themeMode: z.string(),
  }),
  voiceProfile: z.object({
    configured: z.boolean(),
    audience: z.string(),
    voiceSummary: z.string(),
    preferRules: z.array(z.string()),
    avoidRules: z.array(z.string()),
    representativePostIds: z.array(z.string()),
    warnings: z.array(z.string()),
    updatedByName: z.string().nullable(),
    updatedAt: z.number().nullable(),
    publishedPosts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        slug: z.string(),
        updatedAt: z.number(),
      }),
    ),
  }),
  customDomains: z.object({
    domains: z.array(
      z.object({
        id: z.string(),
        hostname: z.string(),
        status: z.string(),
        verificationErrors: z.array(z.string()),
        createdAt: z.number(),
      }),
    ),
    cnameTarget: z.string().nullable(),
  }),
  billingStatus: z.string(),
  selfHosted: z.boolean(),
  isOwner: z.boolean(),
  mcpUrl: z.string(),
  publicBaseUrl: z.string().nullable(),
})
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
  githubEnabled: z.boolean(),
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
  apps: z.array(
    z.object({
      workspaceId: z.string(),
      workspaceName: z.string(),
      siteId: z.string(),
      siteName: z.string(),
      siteSlug: z.string(),
      role: z.enum(['owner', 'editor', 'viewer']),
      managed: z
        .object({
          status: z.enum(['active', 'revoked']),
          expiresAt: z.number().nullable(),
          effective: z.boolean(),
        })
        .nullable(),
    }),
  ),
  siteSetupComplete: z.boolean(),
  siteDisplayName: z.string().nullable(),
})

export const mutationResultSchema = z.object({
  kind: z.enum(['ok', 'error']),
  code: z.string(),
  postId: z.string().optional(),
  versionNumber: z.number().optional(),
})

export const siteLocationSchema = z.object({
  type: z.enum(['default', 'custom', 'subpath']),
  url: z.string().nullable(),
  status: z.enum(['pending', 'active', 'failed', 'disabled']).nullable(),
  proxyTarget: z.string().optional(),
  snippets: z
    .object({
      cloudflareWorker: z.object({ code: z.string(), route: z.string() }),
      vercel: z.string(),
      nextjs: z.string(),
      netlify: z.string(),
      nginx: z.string(),
      caddy: z.string(),
    })
    .optional(),
  lastCheck: z
    .object({
      ok: z.boolean(),
      checkedAt: z.number(),
      errors: z.array(z.object({ code: z.string(), message: z.string() })),
      warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    })
    .optional(),
})

const billingStatusSchema = z.enum(['active', 'past_due', 'canceled', 'unpaid', 'none'])
const entitlementAccessSchema = z.enum(['self_hosted', 'hosted_paid', 'hosted_free'])
const entitlementSourceSchema = z.enum(['self_hosted', 'polar', 'managed_sponsorship', 'none'])
const scheduledPublishSchema = z.object({
  versionNumber: z.number(), publishAt: z.number(),
  status: z.enum(['pending', 'processing', 'published', 'failed']),
  error: z.string().nullable().optional(),
}).nullable().optional()

export const dashboardDataSchema = z.object({
  site: z.object({ name: z.string(), slug: z.string() }).nullable(),
  publicUrl: z.string().nullable(),
  publicUrlLocal: z.boolean(),
  billing: z.object({
    status: billingStatusSchema,
    polarStatus: billingStatusSchema.optional(),
    effective: z.boolean().optional(),
    access: entitlementAccessSchema.optional(),
    source: entitlementSourceSchema.optional(),
    managed: z
      .object({
        status: z.enum(['active', 'revoked']),
        expiresAt: z.number().nullable(),
        effective: z.boolean(),
      })
      .nullable()
      .optional(),
  }),
  apiUsage: z.object({
    enforced: z.boolean(),
    billingStatus: billingStatusSchema.optional(),
    polarStatus: billingStatusSchema.optional(),
    effective: z.boolean().optional(),
    access: entitlementAccessSchema.optional(),
    source: entitlementSourceSchema.optional(),
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
  usedTokenCount: z.number().optional(),
  subscriberCount: z.number().optional(),
  versionCount: z.number(),
  recentPosts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      status: z.string(),
      updatedAt: z.number(),
      publishedAt: z.number().nullable(),
      scheduledPublish: scheduledPublishSchema,
    }),
  ),
  recentDrafts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      status: z.string(),
      updatedAt: z.number(),
      publishedAt: z.number().nullable(),
      scheduledPublish: scheduledPublishSchema,
    }),
  ),
  needsReview: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        slug: z.string(),
        status: z.string(),
        updatedAt: z.number(),
        publishedAt: z.number().nullable(),
        versionNumber: z.number().nullable(),
        publishedVersionNumber: z.number().nullable(),
        latestActorType: z.string().nullable(),
      }),
    )
    .optional(),
  needsReviewCount: z.number().optional(),
  recentActivity: z.array(
    z.object({
      action: z.string(),
      summary: z.string(),
      actor_name: z.string(),
      created_at: z.number(),
    }),
  ),
  activationPost: z
    .object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      publishedAt: z.number(),
      url: z.string().nullable(),
      actorName: z.string(),
    })
    .nullable(),
})

const analyticsBaseSchema = z.object({ retentionDays: z.number().int().positive() })

export const analyticsPageDataSchema = z.discriminatedUnion('status', [
  analyticsBaseSchema.extend({ status: z.literal('locked') }),
  analyticsBaseSchema.extend({
    status: z.literal('unavailable'),
    reason: z.enum(['self_hosted', 'not_configured', 'query_failed']),
  }),
  analyticsBaseSchema.extend({
    status: z.literal('available'),
    rangeDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal('all')]),
    views: z.number(),
    previousViews: z.number().nullable(),
    trendPercent: z.number().nullable(),
    seriesGranularity: z.enum(['day', 'month']),
    aiReferralViews: z.number(),
    series: z.array(z.object({ date: z.string(), views: z.number(), aiCrawlerRequests: z.number() })),
    topPosts: z.array(
      z.object({ postId: z.string(), slug: z.string(), title: z.string(), views: z.number() }),
    ),
    referrers: z.array(
      z.object({ domain: z.string(), views: z.number(), ai: z.boolean(), operator: z.string().nullable() }),
    ),
    aiCrawlers: z.object({
      status: z.enum(['available', 'unavailable']),
      lookbackDays: z.number().int().positive(),
      requests: z.number(),
      agents: z.array(
        z.object({ agent: z.string(), operator: z.string(), category: z.string(), requests: z.number() }),
      ),
    }),
    // Optional: payloads from before the agents breakdown shipped still carry
    // full people data. Missing means "agents unavailable", not a failure.
    agents: z.object({
      total: z.number(),
      byCategory: z.array(
        z.object({
          category: z.enum(['ai-assistant', 'ai-search', 'ai-training', 'search-engine', 'other-bot', 'unknown-agent']),
          fetches: z.number(),
        }),
      ),
      topAgents: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          operator: z.string(),
          category: z.enum(['ai-assistant', 'ai-search', 'ai-training', 'search-engine', 'other-bot', 'unknown-agent']),
          fetches: z.number(),
        }),
      ),
      topPosts: z.array(
        z.object({ postId: z.string(), slug: z.string(), title: z.string(), fetches: z.number() }),
      ),
      markdownShare: z.number(),
      signedShare: z.number(),
      llmsReads: z.number(),
    }).optional(),
  }),
])

export const seoFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warn', 'info']),
  field: z.string(),
  message: z.string(),
  fix: z.string(),
  position: z.number().optional(),
})

export const seoAiReviewSchema = z.object({
  intent: z.string(),
  titleIdeas: z.tuple([z.string(), z.string()]),
  descriptionIdea: z.string(),
  missingSubtopics: z.array(z.string()).max(5),
  unclearPassages: z.array(z.object({ quote: z.string(), why: z.string() })).max(3),
  claimsNeedingSources: z.array(z.object({ quote: z.string() })).max(3),
})

export const seoCheckResultSchema = z.object({
  versionNumber: z.number().int(),
  findings: z.array(seoFindingSchema),
  ai: seoAiReviewSchema.nullable().optional(),
  warnings: z.array(z.string()).optional(),
})

/** Slim read of /api/dashboard/analytics?postId=… — just what the editor rail line needs. */
export const postAnalyticsSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['locked', 'unavailable']) }),
  z.object({
    status: z.literal('available'),
    views: z.number(),
    agents: z.object({ total: z.number() }).optional(),
  }),
])

export const activationKeyInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
})

export const activationFirstPostSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('waiting') }),
  z.object({
    state: z.literal('draft'),
    post: z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      updatedAt: z.number(),
      versionNumber: z.number(),
    }),
  }),
  z.object({
    state: z.literal('live'),
    post: z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      publishedAt: z.number(),
      url: z.string().nullable(),
    }),
    actorName: z.string(),
  }),
])

export const onboardingConnectStatusSchema = z.object({
  canManage: z.boolean(),
  mcpUrl: z.string(),
  publicBaseUrl: z.string().nullable(),
  key: activationKeyInfoSchema.nullable(),
  connection: z.enum(['no_token', 'waiting', 'connected', 'revoked']),
  firstPost: activationFirstPostSchema,
})
export const settingsPageDataSchema = z.object({
  site: z.object({
    name: z.string(),
    description: z.string(),
    defaultSeoTitle: z.string(),
    defaultSeoDescription: z.string(),
    defaultSocialAssetId: z.string().nullable(),
    logoAssetId: z.string().nullable().default(null),
    faviconAssetId: z.string().nullable().default(null),
    navLinks: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    socialLinks: z.array(z.object({ kind: z.enum(["x", "github", "linkedin", "bluesky", "mastodon", "youtube", "instagram", "website", "email"]), url: z.string() })).default([]),
    theme: z.string(),
    slug: z.string(),
    themeAccent: z.string(),
    themeFont: z.string(),
    themeMode: z.string(),
    // Template knobs (resolved against the current template) and the public
    // byline. Defaults keep older API payloads parseable during a deploy.
    themeRadius: z.string().default('md'),
    themeWidth: z.string().default('normal'),
    themeChrome: z.string().default('masthead'),
    themeIndex: z.string().default('list'),
    themeHeader: z.string().default('plain'),
    bylineName: z.string().default(''),
    showAgentCredit: z.boolean().default(true),
    updatedAt: z.number(),
    newsletterSettings: z.object({
      enabled: z.boolean(),
      heading: z.string(),
      subtext: z.string(),
      buttonLabel: z.string(),
    }),
  }),
  assets: z.array(
    z.object({
      id: z.string(),
      siteId: z.string(),
      r2Key: z.string(),
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      altText: z.string().nullable(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
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
  location: siteLocationSchema.nullable(),
  billingStatus: z.string(),
  polarBillingStatus: billingStatusSchema.optional(),
  effectiveEntitlement: z.object({
    effective: z.boolean(),
    access: entitlementAccessSchema,
    source: entitlementSourceSchema,
    effectiveUntil: z.number().nullable(),
  }).optional(),
  managed: z
    .object({
      status: z.enum(['active', 'revoked']),
      expiresAt: z.number().nullable(),
      effective: z.boolean(),
    })
    .nullable()
    .optional(),
  selfHosted: z.boolean(),
  isOwner: z.boolean(),
  mcpUrl: z.string(),
  publicBaseUrl: z.string().nullable(),
})
export const newsletterSettingsSchema = z.object({
  enabled: z.boolean(),
  heading: z.string(),
  subtext: z.string(),
  buttonLabel: z.string(),
})

export const subscribersPageLoadSchema = z.object({
  rows: z.array(z.object({
    id: z.string(),
    email: z.string(),
    status: z.enum(['pending', 'confirmed', 'unsubscribed']),
    sourceUrl: z.string().nullable(),
    createdAt: z.number(),
    consentVersion: z.string(),
  })),
  total: z.number(),
  pendingCount: z.number(),
})

import { z } from "zod";

const RESERVED_SITE_SLUG_NAMES = [
  // infrastructure, collision, auth, brand
  "app", "www", "api", "mcp", "dashboard", "admin", "auth", "login", "account", "accounts",
  "billing", "checkout", "payments", "oauth", "sso", "mail", "smtp", "imap", "pop", "mx",
  "ns", "ns1", "ns2", "dns", "cdn", "static", "assets", "media", "status", "vibecms",
  "official", "support", "help", "abuse", "security", "postmaster", "webmaster", "hostmaster",
  "root", "noreply", "no-reply", "system", "internal",
  // ops, environments, impersonation
  "dev", "staging", "stage", "test", "qa", "demo", "sandbox", "preview", "beta", "alpha",
  "prod", "production", "edge", "origin", "proxy", "gateway", "vpn", "ftp", "git", "ci",
  "cache", "monitor", "metrics", "health", "contact", "about", "legal", "privacy", "terms",
  "careers", "jobs", "press", "team", "store", "shop", "pay", "blog",
];

// Platform-reserved slugs (exact match): block infra collisions (app/www/api/...) and impersonation (support/billing/...).
export const RESERVED_SITE_SLUGS: Record<string, true> = Object.fromEntries(
  RESERVED_SITE_SLUG_NAMES.map((name) => [name, true] as const),
);

export function isReservedSiteSlug(slug: string): boolean {
  return RESERVED_SITE_SLUGS[slug.trim().toLowerCase()] === true;
}

export const createSiteInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((value) => !isReservedSiteSlug(value), { message: "That name is reserved." }),
  description: z.string().trim().max(300).optional(),
}).strict();

export const VOICE_PROFILE_MAX_GUIDELINES = 12;
export const VOICE_PROFILE_MAX_REPRESENTATIVE_POSTS = 3;

export const voiceGuidelineSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("explicit") }).strict(),
  z.object({
    kind: z.literal("approved_edit"),
    postId: z.string().trim().min(1).max(120),
    versionNumber: z.number().int().positive(),
  }).strict(),
]);

export const voiceGuidelineSchema = z.object({
  kind: z.enum(["prefer", "avoid"]),
  text: z.string().trim().min(1).max(200),
  source: voiceGuidelineSourceSchema,
}).strict();

const representativePostIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(VOICE_PROFILE_MAX_REPRESENTATIVE_POSTS)
  .refine((ids) => new Set(ids).size === ids.length, "Representative posts must be unique");

export const siteVoiceProfileInputSchema = z.object({
  audience: z.string().trim().max(300).nullable(),
  voiceSummary: z.string().trim().max(500).nullable(),
  guidelines: z.array(voiceGuidelineSchema).max(VOICE_PROFILE_MAX_GUIDELINES),
  representativePostIds: representativePostIdsSchema,
}).strict();

export const voiceProfileSettingsInputSchema = z.object({
  audience: z.string().trim().max(300).optional(),
  voiceSummary: z.string().trim().max(500).optional(),
  preferRules: z.array(z.string().trim().min(1).max(200)).max(VOICE_PROFILE_MAX_GUIDELINES),
  avoidRules: z.array(z.string().trim().min(1).max(200)).max(VOICE_PROFILE_MAX_GUIDELINES),
  representativePostIds: representativePostIdsSchema,
}).strict().superRefine((value, context) => {
  if (value.preferRules.length + value.avoidRules.length > VOICE_PROFILE_MAX_GUIDELINES) {
    context.addIssue({
      code: "too_big",
      origin: "array",
      maximum: VOICE_PROFILE_MAX_GUIDELINES,
      inclusive: true,
      path: ["preferRules"],
      message: `Use at most ${VOICE_PROFILE_MAX_GUIDELINES} voice rules in total`,
    });
  }
});

export type SiteVoiceProfileInput = z.infer<typeof siteVoiceProfileInputSchema>;
export type VoiceProfileSettingsInput = z.infer<typeof voiceProfileSettingsInputSchema>;

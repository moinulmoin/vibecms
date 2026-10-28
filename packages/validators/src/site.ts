import { z } from "zod";
import { SITE_ADDRESS_MAX_LENGTH, SITE_ADDRESS_MIN_LENGTH } from "@vc/config";

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

/**
 * Blog name or typed address -> hosted address label: lowercase a-z, digits,
 * single hyphens. Latin diacritics fold to their base letter; scripts without a
 * Latin decomposition (Cyrillic, CJK, emoji) and symbol-only input yield "".
 * Setup client and server both use this so the preview is the saved address.
 */
export function siteAddressFromText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SITE_ADDRESS_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export type SiteAddressIssue = "address_required" | "slug_reserved" | "address_too_short";

/**
 * Problem with a normalized address, or null when it can be claimed (uniqueness
 * is checked by the database). The minimum length applies to newly chosen
 * addresses only: re-saving `currentAddress` keeps existing short sites working.
 */
export function siteAddressIssue(address: string, currentAddress?: string | null): SiteAddressIssue | null {
  if (!address) return "address_required";
  if (isReservedSiteSlug(address)) return "slug_reserved";
  if (address.length < SITE_ADDRESS_MIN_LENGTH && address !== currentAddress) return "address_too_short";
  return null;
}

// Site slugs become the left-most label in `<slug>.<public-domain>`.
export const SITE_SLUG_MAX_LENGTH = 63;

export const createSiteInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .min(SITE_ADDRESS_MIN_LENGTH)
    .max(SITE_SLUG_MAX_LENGTH)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((value) => !isReservedSiteSlug(value), { message: "That address is reserved." }),
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
export const NEWSLETTER_HEADING_MAX_LENGTH = 80;
export const NEWSLETTER_SUBTEXT_MAX_LENGTH = 160;
export const NEWSLETTER_BUTTON_LABEL_MAX_LENGTH = 24;

export const externalNewsletterFormSchema = z.object({
  action: z.string().max(500).url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Use an HTTPS URL with a domain and no user information"),
  emailField: z.string().regex(/^[A-Za-z0-9_\-\[\].:]{1,64}$/),
}).strict();

export const newsletterSettingsSchema = z.object({
  enabled: z.boolean(),
  heading: z.string().trim().min(1).max(NEWSLETTER_HEADING_MAX_LENGTH),
  subtext: z.string().trim().min(1).max(NEWSLETTER_SUBTEXT_MAX_LENGTH),
  buttonLabel: z.string().trim().min(1).max(NEWSLETTER_BUTTON_LABEL_MAX_LENGTH),
  externalForm: externalNewsletterFormSchema.nullable().default(null),
}).strict();

export type NewsletterSettings = z.infer<typeof newsletterSettingsSchema>;

export const navLinkSchema = z.object({
  label: z.string().trim().min(1, 'Enter a label').max(40, 'Use 40 characters or fewer'),
  url: z.string().trim().min(1, 'Enter a URL').refine((value) => value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f]/.test(value) || /^(https?:\/\/|mailto:)/i.test(value) && isSafeLinkUrl(value), 'Use a path, http(s), or mailto URL'),
}).strict();

function isSafeLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && Boolean(url.pathname);
  } catch { return false; }
}

export const navLinksSchema = z.array(navLinkSchema).max(6);
export const socialKindSchema = z.enum(['x', 'github', 'linkedin', 'bluesky', 'mastodon', 'youtube', 'instagram', 'website', 'email']);
export const socialLinkSchema = z.object({
  kind: socialKindSchema,
  url: z.string().trim().min(1, 'Enter a URL'),
}).strict().transform(({ kind, url }) => ({
  kind,
  url: kind === 'email' && !url.toLowerCase().startsWith('mailto:') ? `mailto:${url}` : url,
})).refine(({ kind, url }) => kind === 'email'
  ? /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url)
  : /^https:\/\//i.test(url) && isSafeLinkUrl(url), 'Use a valid link for this service');
export const socialLinksSchema = z.array(socialLinkSchema).max(8);
export type NavLink = z.infer<typeof navLinkSchema>;
export type SocialLink = z.infer<typeof socialLinkSchema>;

export function parseSiteLinks<T>(raw: string | null | undefined, schema: z.ZodType<T>): T {
  try { return schema.parse(raw ? JSON.parse(raw) : []); }
  catch { return schema.parse([]); }
}

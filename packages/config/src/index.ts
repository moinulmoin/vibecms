export type AppEnv = "development" | "preview" | "production" | "test";

export type RuntimeEnv = {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  APP_ENV: AppEnv | string;
  APP_URL: string;
  PUBLIC_BLOG_DOMAIN: string;
  SELF_HOSTED?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRODUCT_ID?: string;
  POLAR_MONTHLY_PRODUCT_ID?: string;
  POLAR_YEARLY_PRODUCT_ID?: string;
  POLAR_SERVER?: "sandbox" | "production";
  TOKEN_PEPPER?: string;
  API_USAGE_TEST_LIMIT?: string;
};

const productionOnly = [
  "APP_URL",
  "PUBLIC_BLOG_DOMAIN",
  "TOKEN_PEPPER",
] as const;

const hostedProductionOnly = [
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_PRODUCT_ID",
] as const;

export function assertRuntimeEnv(env: Partial<RuntimeEnv>): asserts env is RuntimeEnv {
  if (!env.DB) throw new Error("Missing DB binding");
  if (!env.ASSETS_BUCKET) throw new Error("Missing ASSETS_BUCKET binding");
  if (!env.APP_ENV) throw new Error("Missing APP_ENV");
  if (env.APP_ENV === "production") {
    for (const key of productionOnly) {
      if (!env[key]) throw new Error(`Missing required production env: ${key}`);
    }
    if (env.SELF_HOSTED !== "true") {
      for (const key of hostedProductionOnly) {
        if (!env[key]) throw new Error(`Missing required hosted production env: ${key}`);
      }
    }
  }
}

export const BRAND = {
  name: "VibeCMS",
  tagline: "CMS for AI Agents.",
  description:
    "Write in Markdown, manage media and versions, and let agents write, draft, and publish through MCP.",
  repoUrl: "https://github.com/moinulmoin/vibecms",
} as const;

export const MEDIA = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImageLabel: "10\u00a0MB",
  paidStorageBytes: 5 * 1024 * 1024 * 1024,
  paidStorageLabel: "5\u00a0GB",
  formats: ["JPEG", "PNG", "WebP", "GIF"] as const,
  formatsLabel: "JPEG, PNG, WebP, GIF",
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] as const,
} as const;

export const API_USAGE_LIMITS = {
  paid: {
    calls: { minute: 120, day: 5_000, month: 25_000 },
    writes: { day: 500, month: 2_000 },
    token: { minute: 60 },
  },
  free: {
    calls: { minute: 30, day: 300, month: 1_000 },
    writes: { day: 50, month: 200 },
    token: { minute: 20 },
  },
  dev: {
    calls: { minute: 1_000, day: 100_000, month: 1_000_000 },
    writes: { day: 10_000, month: 100_000 },
    token: { minute: 1_000 },
  },
} as const;

/** Max active (non-revoked) API tokens per workspace. Leak/abuse guard; owners revoke to free slots. */
export const API_TOKENS_MAX = 10;

export const PRICING = {
  planName: "VibeCMS Cloud",
  monthlyUsd: 19,
  annualUsd: 190,
  monthlyLabel: "$19/month",
  annualLabel: "$190/year",
} as const;

export const ENTITLEMENTS = [
  "1 hosted blog",
  "Unlimited posts",
  "Scoped MCP access",
  "Activity history",
  "Post version history",
] as const;

export type FormStatusVariant = "success" | "error";

export interface FormStatus {
  variant: FormStatusVariant;
  title: string;
  message: string;
}

/**
 * Allowlisted status codes for the post-redirect (303) Alert pattern.
 * Handlers redirect with `?ok=<code>` or `?error=<code>`; pages render the
 * matching copy. NEVER place raw error messages or user input in the URL.
 */
export const FORM_STATUS: Record<string, FormStatus> = {
  post_created: { variant: "success", title: "Post created", message: "Your draft has been saved." },
  post_saved: { variant: "success", title: "Changes saved", message: "Your post has been updated." },
  post_published: { variant: "success", title: "Post published", message: "It is now live on your blog." },
  post_archived: { variant: "success", title: "Post archived", message: "It is hidden from the public blog. Versions and activity are kept." },
  media_uploaded: { variant: "success", title: "Image uploaded", message: "It is ready to use as a cover image." },
  setup_complete: { variant: "success", title: "Blog ready", message: "Your hosted blog is set up." },
  token_created: { variant: "success", title: "Token created", message: "Copy it now. It will not be shown again." },
  token_revoked: { variant: "success", title: "Token revoked", message: "That token can no longer access your workspace." },
  billing_success: { variant: "success", title: "Subscription active", message: "Billing is set up. Welcome aboard." },
  invalid_cover_asset: { variant: "error", title: "Cover image not found", message: "Pick an image from your media library." },
  upload_missing_file: { variant: "error", title: "No file selected", message: "Choose an image to upload." },
  upload_type: { variant: "error", title: "Unsupported file type", message: "Upload a JPEG, PNG, WebP, or GIF image." },
  upload_too_large: { variant: "error", title: "Image too large", message: "Images must be 10\u00a0MB or smaller." },
  media_quota_paid: { variant: "error", title: "Storage full", message: "You have reached the 5\u00a0GB media limit." },
  billing_required: { variant: "error", title: "Subscription required", message: "Subscribe to publish more posts and to upload media. Drafting and your first published post stay free." },
  owner_required: { variant: "error", title: "Owner access required", message: "Only the workspace owner can do that." },
  polar_unconfigured: { variant: "error", title: "Billing unavailable", message: "Billing is not configured right now. Please try again later." },
  checkout_failed: { variant: "error", title: "Checkout unavailable", message: "We could not start checkout. Please try again." },
  not_found: { variant: "error", title: "Not found", message: "We could not find what you were looking for." },
  slug_conflict: { variant: "error", title: "Slug already exists", message: "Choose a different post slug." },
  token_expired: { variant: "error", title: "Token unavailable", message: "The token could not be shown. Create a new one." },
  token_limit: { variant: "error", title: "Token limit reached", message: `Revoke an unused token first. Up to ${API_TOKENS_MAX} active tokens are allowed.` },
  yearly_unavailable: { variant: "error", title: "Yearly plan unavailable", message: "Yearly billing is not configured yet. Choose monthly for now." },
  unknown: { variant: "error", title: "Something went wrong", message: "Please try again." },
};

/** Resolve an Alert from a page's URL search params. Error takes precedence over ok. */
export function readFormStatus(search: URLSearchParams): FormStatus | null {
  const error = search.get("error");
  if (error) return FORM_STATUS[error] ?? FORM_STATUS.unknown;
  const ok = search.get("ok");
  if (ok) return FORM_STATUS[ok] ?? null;
  return null;
}
// ---------------------------------------------------------------------------
// Theme preset registry
// ---------------------------------------------------------------------------

export type PresetId = "minimal" | "editorial" | "technical" | "product";

export const PRESET_IDS: readonly PresetId[] = [
  "minimal",
  "editorial",
  "technical",
  "product",
];

export const DEFAULT_PRESET_ID: PresetId = "minimal";

export type ComponentEmphasis = "high" | "medium" | "low";

export interface ThemePreset {
  id: PresetId;
  /** Display name shown in the picker. */
  name: string;
  /** 1-2 sentence picker-facing description. */
  designIntent: string;
  /**
   * Ordered list of recommended components. Only real renderer components:
   * callout, table-of-contents, captioned-image, fenced-code, table, list,
   * link, bold-italic, blockquote.
   */
  recommendedComponents: string[];
  /** Relative weight per component name. */
  componentEmphasis: Record<string, ComponentEmphasis>;
  /** Preferred image aspect ratio, e.g. "16:9" or "3:2". */
  preferredImageRatio: string;
  density: "airy" | "comfortable" | "tight";
  /** Content archetypes this preset is optimised for. */
  idealArchetypes: string[];
  /**
   * Agent-facing tonal authoring guidance. Returned as
   * FormatGuideDto.presetGuidance by the format_guide tool.
   */
  formatGuide: string;
}

export const THEME_PRESETS: Record<PresetId, ThemePreset> = {
  minimal: {
    id: "minimal",
    name: "Minimal",
    designIntent:
      "Clean, airy, and neutral. A general-purpose canvas that stays out of the way and lets your words lead.",
    recommendedComponents: [
      "list",
      "link",
      "bold-italic",
      "callout",
      "captioned-image",
      "table",
      "fenced-code",
      "blockquote",
      "table-of-contents",
    ],
    componentEmphasis: {
      list: "high",
      link: "high",
      "bold-italic": "medium",
      callout: "medium",
      "captioned-image": "medium",
      table: "medium",
      "fenced-code": "medium",
      blockquote: "low",
      "table-of-contents": "low",
    },
    preferredImageRatio: "16:9",
    density: "airy",
    idealArchetypes: ["general", "newsletter", "personal"],
    formatGuide:
      "Write clearly and directly. Prefer short sentences and concrete examples. " +
      "Use callouts sparingly - one per section at most. Let structure carry meaning.",
  },

  editorial: {
    id: "editorial",
    name: "Editorial",
    designIntent:
      "Serif headings, wide measure, and media-rich narrative flow. Built for long-form storytelling, essays, and reported pieces.",
    recommendedComponents: [
      "captioned-image",
      "blockquote",
      "bold-italic",
      "list",
      "link",
      "callout",
      "fenced-code",
      "table",
      "table-of-contents",
    ],
    componentEmphasis: {
      "captioned-image": "high",
      blockquote: "high",
      "bold-italic": "high",
      list: "medium",
      link: "medium",
      callout: "low",
      "fenced-code": "low",
      table: "low",
      "table-of-contents": "low",
    },
    preferredImageRatio: "3:2",
    density: "comfortable",
    idealArchetypes: ["essay", "narrative", "longform"],
    formatGuide:
      "Lead with a strong opening image or scene-setting paragraph. " +
      "Place a captioned image every two or three sections to anchor the narrative. " +
      "Use blockquotes sparingly as pull quotes - one standout sentence per section at most. " +
      "Keep code to a minimum; if you must include it, prefer a short fenced block with a language label. " +
      "Let prose carry the weight; avoid heavy structural markup.",
  },

  technical: {
    id: "technical",
    name: "Technical",
    designIntent:
      "Monospace emphasis, prominent table of contents, and tight density. Optimised for documentation, tutorials, and reference guides.",
    recommendedComponents: [
      "table-of-contents",
      "fenced-code",
      "callout",
      "table",
      "list",
      "link",
      "captioned-image",
      "bold-italic",
      "blockquote",
    ],
    componentEmphasis: {
      "table-of-contents": "high",
      "fenced-code": "high",
      callout: "high",
      table: "high",
      list: "high",
      link: "medium",
      "captioned-image": "medium",
      "bold-italic": "medium",
      blockquote: "low",
    },
    preferredImageRatio: "16:9",
    density: "tight",
    idealArchetypes: ["docs", "tutorial", "reference"],
    formatGuide:
      "Open with [[toc]] for any post longer than three sections. " +
      "Always include a language label on fenced code blocks. " +
      "Use callouts with purpose - NOTE for context, TIP for shortcuts, WARNING for gotchas. " +
      "Tables work well for option references and comparisons. " +
      "Keep paragraphs short and factual; favour precision over decoration.",
  },

  product: {
    id: "product",
    name: "Product",
    designIntent:
      "Clean, confident, and conversion-aware. Built for founder updates, launch announcements, and company news.",
    recommendedComponents: [
      "captioned-image",
      "callout",
      "list",
      "bold-italic",
      "link",
      "blockquote",
      "table",
      "fenced-code",
      "table-of-contents",
    ],
    componentEmphasis: {
      "captioned-image": "high",
      callout: "high",
      list: "high",
      "bold-italic": "high",
      link: "high",
      blockquote: "medium",
      table: "medium",
      "fenced-code": "low",
      "table-of-contents": "low",
    },
    preferredImageRatio: "16:9",
    density: "comfortable",
    idealArchetypes: ["announcement", "launch", "company-update"],
    formatGuide:
      "Lead with the announcement in the first paragraph - no slow build. " +
      "Place a captioned hero image immediately after the opener. " +
      "Use IMPORTANT or TIP callouts for availability dates, pricing, or key highlights. " +
      "Keep sections short and scannable with clear bold-italic emphasis on key terms. " +
      "Close with a clear next step (link or CTA paragraph) so readers know what to do. " +
      "Avoid deep code samples; this is a business voice.",
  },
};

/** Returns the given value if it is a known PresetId, otherwise DEFAULT_PRESET_ID. */
export function resolvePresetId(value: string | null | undefined): PresetId {
  if (value != null && (PRESET_IDS as readonly string[]).includes(value)) {
    return value as PresetId;
  }
  return DEFAULT_PRESET_ID;
}

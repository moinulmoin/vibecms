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
  tagline: "The blog CMS for humans and AI agents.",
  description:
    "Publish from a clean dashboard, or let trusted agents draft and update posts through scoped MCP and API access. Cloudflare-native and open source.",
  repoUrl: "https://github.com/moinulmoin/vibecms",
} as const;

export const MEDIA = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImageLabel: "10\u00a0MB",
  trialStorageBytes: 500 * 1024 * 1024,
  trialStorageLabel: "500\u00a0MB",
  paidStorageBytes: 5 * 1024 * 1024 * 1024,
  paidStorageLabel: "5\u00a0GB",
  formats: ["JPEG", "PNG", "WebP", "GIF"] as const,
  formatsLabel: "JPEG, PNG, WebP, GIF",
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] as const,
} as const;

export const PRICING = {
  planName: "VibeCMS Cloud",
  monthlyUsd: 9,
  annualUsd: 99,
  monthlyLabel: "$9/month",
  annualLabel: "$99/year",
  trialDays: 7,
  trialLabel: "7-day free trial, card required",
} as const;

export const ENTITLEMENTS = [
  "1 hosted blog",
  "Unlimited posts",
  "Scoped MCP & API access",
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
  theme_saved: { variant: "success", title: "Theme updated", message: "Your public blog now uses the new theme." },
  invalid_cover_asset: { variant: "error", title: "Cover image not found", message: "Pick an image from your media library." },
  upload_missing_file: { variant: "error", title: "No file selected", message: "Choose an image to upload." },
  upload_type: { variant: "error", title: "Unsupported file type", message: "Upload a JPEG, PNG, WebP, or GIF image." },
  upload_too_large: { variant: "error", title: "Image too large", message: "Images must be 10\u00a0MB or smaller." },
  media_quota_trial: { variant: "error", title: "Trial storage full", message: "Trial media is capped at 500\u00a0MB. Subscribe for 5\u00a0GB." },
  media_quota_paid: { variant: "error", title: "Storage full", message: "You have reached the 5\u00a0GB media limit." },
  billing_required: { variant: "error", title: "Subscription required", message: "Start a trial or subscribe to use this feature." },
  owner_required: { variant: "error", title: "Owner access required", message: "Only the workspace owner can do that." },
  polar_unconfigured: { variant: "error", title: "Billing unavailable", message: "Billing is not configured right now. Please try again later." },
  not_found: { variant: "error", title: "Not found", message: "We could not find what you were looking for." },
  token_expired: { variant: "error", title: "Token unavailable", message: "The token could not be shown. Create a new one." },
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

export const THEMES = [
  { id: "minimal", label: "Minimal", description: "Clean sans-serif, airy and light. The calm default.", colorMode: "light" },
  { id: "editorial", label: "Editorial", description: "Serif headlines and a generous reading measure.", colorMode: "light" },
  { id: "terminal", label: "Terminal", description: "Monospace on deep ink. Built for builders.", colorMode: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "minimal";

export function normalizeTheme(value: string | null | undefined): ThemeId {
  return THEMES.some((theme) => theme.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}

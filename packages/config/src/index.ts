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
  tagline: "CMS for humans and AI agents.",
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
  monthlyUsd: 9,
  annualUsd: 99,
  monthlyLabel: "$9/month",
  annualLabel: "$99/year",
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
  billing_required: { variant: "error", title: "Subscription required", message: "Subscribe to publish posts and upload media. Drafting stays free." },
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

export const BRAND = {
  name: "vibecms",
  tagline: "CMS for AI Agents.",
  description:
    "The CMS your agents publish into: Markdown posts, versions, and media over scoped MCP - you own every post.",
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

export function hasActiveSubscription(status: string | null | undefined): boolean {
  return status === "active";
}

/** Max active (non-revoked) API tokens per workspace. Leak/abuse guard; owners revoke to free slots. */
export const API_TOKENS_MAX = 10;

export const PRICING = {
  planName: "vibecms Cloud",
  monthlyUsd: 19,
  annualUsd: 190,
  monthlyLabel: "$19/month",
  annualLabel: "$190/year",
} as const;

export const ENTITLEMENTS = [
  "1 hosted blog",
  "Unlimited posts",
  "Scoped MCP access",
  "Activity & version history",
  "Reader & AI discovery analytics",
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
  media_deleted: { variant: "success", title: "Image deleted", message: "The image has been removed from your library." },
  media_updated: { variant: "success", title: "Alt text saved", message: "The image description has been updated." },
  asset_in_use: { variant: "error", title: "Image in use", message: "Remove this image from post covers and site social settings before deleting it." },
  setup_complete: { variant: "success", title: "Blog ready", message: "Your hosted blog is set up." },
  token_created: { variant: "success", title: "Token created", message: "Copy it now. It will not be shown again." },
  token_revoked: { variant: "success", title: "Token revoked", message: "That token can no longer access your workspace." },
  token_deleted: { variant: "success", title: "Token deleted", message: "That token can no longer access your workspace." },
  billing_success: { variant: "success", title: "Subscription active", message: "Billing is set up. Welcome aboard." },
  domain_added: { variant: "success", title: "Domain added", message: "Add the DNS record shown below to finish connecting it." },
  domain_removed: { variant: "success", title: "Domain removed", message: "It no longer points to your blog." },
  voice_profile_saved: { variant: "success", title: "Voice Profile saved", message: "Agents will receive this writing guidance when they inspect your site." },
  voice_profile_cleared: { variant: "success", title: "Voice Profile cleared", message: "Agents will use your current request, published examples, and format guidance instead." },
  voice_invalid_exemplars: { variant: "error", title: "Representative post unavailable", message: "Choose up to three currently published posts from this site." },
  voice_profile_invalid: { variant: "error", title: "Voice Profile not saved", message: "Check the field limits and use no more than 12 prefer/avoid rules." },
  domain_invalid: { variant: "error", title: "Invalid domain", message: "Enter a domain you own, for example blog.example.com." },
  domain_conflict: { variant: "error", title: "Domain in use", message: "That domain is already connected to another blog." },
  domain_billing: { variant: "error", title: "Subscription required", message: "Custom domains are a paid feature. Subscribe to connect your own domain." },
  domain_provisioning: {
    variant: "error",
    title: "Domain provisioning failed",
    message: "Cloudflare could not provision this domain yet. Open Domains settings and refresh to retry.",
  },
  invalid_cover_asset: { variant: "error", title: "Cover image not found", message: "Pick an image from your media library." },
  image_alt_required: { variant: "error", title: "Alt text required", message: "Add alt text to every featured and inline image before publishing." },
  invalid_social_image: { variant: "error", title: "Social image not found", message: "Choose an image from your media library." },
  social_image_alt_required: { variant: "error", title: "Alt text required", message: "Add alt text to the selected social image before saving." },
  alt_required_in_use: { variant: "error", title: "Alt text required", message: "This image is in use. Replace it or keep a useful description." },
  upload_missing_file: { variant: "error", title: "No file selected", message: "Choose an image to upload." },
  upload_type: { variant: "error", title: "Unsupported file type", message: "Upload a JPEG, PNG, WebP, or GIF image." },
  upload_too_large: { variant: "error", title: "Image too large", message: "Images must be 10\u00a0MB or smaller." },
  media_quota_paid: { variant: "error", title: "Storage full", message: "You have reached the 5\u00a0GB media limit." },
  billing_required: { variant: "error", title: "Subscription required", message: "Subscribe to publish more posts and to upload media. Your first 5 published posts are free." },
  owner_required: { variant: "error", title: "Owner access required", message: "Only the workspace owner can do that." },
  polar_unconfigured: { variant: "error", title: "Billing unavailable", message: "Billing is not configured right now. Please try again later." },
  checkout_failed: { variant: "error", title: "Checkout unavailable", message: "We could not start checkout. Please try again." },
  already_active: { variant: "error", title: "Subscription already active", message: "This workspace already has an active plan. Manage it from the customer portal." },
  not_found: { variant: "error", title: "Not found", message: "We could not find what you were looking for." },
  slug_conflict: { variant: "error", title: "Slug already exists", message: "Choose a different post slug." },
  version_conflict: { variant: "error", title: "Post changed", message: "Review the latest version, then publish again." },
  slug_reserved: { variant: "error", title: "Name reserved", message: "That name is reserved. Please choose another." },
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
// Theme customizer (Layer 2): curated accents, font pairings, color mode
// ---------------------------------------------------------------------------
//
// Model: ONE neutral base (minimal). Flavor comes from accent + font + mode,
// NOT separate neutral palettes. Semantic callout hues (note/tip/important/
// warning/caution) are FIXED universal and never derived from the accent.
//
// Every accent swatch is AA-verified: its accent/link text reaches >=4.5:1
// contrast against the base `--vc-bg` in BOTH light and dark. The recorded
// ratio per swatch is documented on the swatch (computed via OKLCH -> sRGB ->
// WCAG luminance; bg light = oklch(98.7% 0.004 106), bg dark = oklch(15% 0.008 168)).

export interface AccentSwatch {
  /** Stable id persisted on `sites.theme_accent`. */
  id: string;
  /** Picker-facing label. */
  name: string;
  /** OKLCH accent for links/buttons/focus on the LIGHT base. AA-verified >=4.5:1. */
  oklchLight: string;
  /** OKLCH accent for links/buttons/focus on the DARK base. AA-verified >=4.5:1. */
  oklchDark: string;
}

/**
 * Curated accent swatches. Each entry's oklchLight/oklchDark is the AA-verified
 * accent/link text color for that mode. Ids are stable persistence keys.
 * Default accent (`teal`) equals the minimal base accent oklch(45% 0.11 154).
 */
export const ACCENTS = [
  { id: "teal",    name: "Teal",    oklchLight: "oklch(45% 0.11 154)",  oklchDark: "oklch(81% 0.170 153)" },
  { id: "blue",    name: "Blue",    oklchLight: "oklch(45% 0.17 245)",  oklchDark: "oklch(75% 0.15 245)" },
  { id: "indigo",  name: "Indigo",  oklchLight: "oklch(45% 0.18 275)",  oklchDark: "oklch(74% 0.15 275)" },
  { id: "violet",  name: "Violet",  oklchLight: "oklch(45% 0.17 300)",  oklchDark: "oklch(78% 0.14 300)" },
  { id: "magenta", name: "Magenta", oklchLight: "oklch(50% 0.16 340)",  oklchDark: "oklch(78% 0.15 340)" },
  { id: "crimson", name: "Crimson", oklchLight: "oklch(50% 0.18 25)",   oklchDark: "oklch(77% 0.15 25)" },
  { id: "rust",    name: "Rust",    oklchLight: "oklch(50% 0.14 50)",   oklchDark: "oklch(80% 0.13 50)" },
  { id: "green",   name: "Green",   oklchLight: "oklch(45% 0.12 145)",  oklchDark: "oklch(80% 0.15 145)" },
] as const satisfies readonly AccentSwatch[];

export type AccentId = (typeof ACCENTS)[number]["id"];

export const ACCENT_IDS: readonly AccentId[] = ACCENTS.map((a) => a.id);

/** Default accent; equals the minimal base accent. */
export const DEFAULT_ACCENT_ID: AccentId = "teal";

export interface FontPairing {
  /** Stable id persisted on `sites.theme_font`. */
  id: string;
  /** Picker-facing label. */
  name: string;
  /** CSS font-family stack for body copy (binds `--vc-font-body`). */
  bodyStack: string;
  /** CSS font-family stack for headings (binds `--vc-font-heading`). */
  headingStack: string;
}

/**
 * Curated font pairings. Stacks reference the variable web fonts already
 * loaded via @font-face (Geist, Geist Mono, Space Grotesk, Hanken Grotesk,
 * JetBrains Mono) with safe OS fallbacks.
 */
export const FONTS = [
  {
    id: "geist-sans",
    name: "Geist Sans",
    bodyStack: "Geist, ui-sans-serif, system-ui, sans-serif",
    headingStack: "Geist, ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "serif",
    name: "Editorial Serif",
    bodyStack: '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
    headingStack: 'Georgia, "Times New Roman", ui-serif, serif',
  },
  {
    id: "grotesk",
    name: "Space Grotesk",
    bodyStack: "Geist, ui-sans-serif, system-ui, sans-serif",
    headingStack: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  },
] as const satisfies readonly FontPairing[];

export type FontId = (typeof FONTS)[number]["id"];

export const FONT_IDS: readonly FontId[] = FONTS.map((f) => f.id);

/** Default font; the minimal base Geist sans pairing. */
export const DEFAULT_FONT_ID: FontId = "geist-sans";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "system";

/**
 * One-click starter looks. Each seeds accent (and optionally font) for the
 * customizer when a preset is picked. The preset's own visual identity
 * (measure, leading, heading scale, rhythm, radius, chrome) comes from
 * `data-vc-theme="<id>"` — see presets.css "PRESET IDENTITIES".
 */
export interface StarterLook {
  accent: AccentId;
  font?: FontId;
}

export const STARTER_LOOKS = {
  editorial: { accent: "rust", font: "serif" },
  technical: { accent: "blue" },
  product: { accent: "green" },
} as const satisfies Record<string, StarterLook>;

export type StarterLookId = keyof typeof STARTER_LOOKS;

/** Returns the given value if it is a known AccentId, otherwise DEFAULT_ACCENT_ID. */
export function resolveAccent(value: string | null | undefined): AccentId {
  if (value != null && (ACCENT_IDS as readonly string[]).includes(value)) {
    return value as AccentId;
  }
  return DEFAULT_ACCENT_ID;
}

/** Returns the given value if it is a known FontId, otherwise DEFAULT_FONT_ID. */
export function resolveFont(value: string | null | undefined): FontId {
  if (value != null && (FONT_IDS as readonly string[]).includes(value)) {
    return value as FontId;
  }
  return DEFAULT_FONT_ID;
}

/** Returns the given value if it is a known ThemeMode, otherwise DEFAULT_THEME_MODE. */
export function resolveMode(value: string | null | undefined): ThemeMode {
  if (value != null && (THEME_MODES as readonly string[]).includes(value)) {
    return value as ThemeMode;
  }
  return DEFAULT_THEME_MODE;
}

/** Accent swatch record for a resolved id; always defined (falls back to default). */
export function getAccent(id: AccentId): AccentSwatch {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

/** Font pairing record for a resolved id; always defined (falls back to default). */
export function getFont(id: FontId): FontPairing {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
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

// ---------------------------------------------------------------------------
// Presentation intent (bounded layout + toc; per-post, preset-interpreted)
// ---------------------------------------------------------------------------

export const PRESENTATION_LAYOUTS = ["standard", "feature", "essay"] as const;
export type PresentationLayout = (typeof PRESENTATION_LAYOUTS)[number];

export interface Presentation {
  layout?: PresentationLayout;
  toc?: boolean;
}

export interface PresetLayoutCapability {
  default: { layout: PresentationLayout; toc: boolean };
  supportedLayouts: readonly PresentationLayout[];
  supportsToc: boolean;
}

export interface ResolvedPresentation {
  layout: PresentationLayout;
  toc: boolean;
}

export interface ResolvedPresentationResult {
  requested: Presentation | null;
  resolved: ResolvedPresentation;
  warnings: string[];
}

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
  /** Structural layout capability for this preset. */
  layout: PresetLayoutCapability;
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
    layout: {
      default: { layout: "standard", toc: false },
      supportedLayouts: ["standard"],
      supportsToc: false,
    },
  },

  editorial: {
    id: "editorial",
    name: "Editorial",
    designIntent:
      "Serif headings, pull quotes, and a relaxed narrative rhythm. Built for long-form storytelling, essays, and reported pieces.",
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
      "Let prose carry the weight; avoid heavy structural markup. " +
      "For long essays, prefer setting presentation.toc=true for a page-level table of contents; use inline [[toc]] only as an intentional in-body marker.",
    layout: {
      default: { layout: "essay", toc: false },
      supportedLayouts: ["standard", "essay"],
      supportsToc: true,
    },
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
      "For posts longer than three sections, prefer setting presentation.toc=true (page-level TOC); use inline [[toc]] only as an intentional in-body marker. " +
      "Always include a language label on fenced code blocks. " +
      "Use callouts with purpose - NOTE for context, TIP for shortcuts, WARNING for gotchas. " +
      "Tables work well for option references and comparisons. " +
      "Keep paragraphs short and factual; favour precision over decoration.",
    layout: {
      default: { layout: "standard", toc: false },
      supportedLayouts: ["standard"],
      supportsToc: true,
    },
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
    layout: {
      default: { layout: "feature", toc: false },
      supportedLayouts: ["standard", "feature"],
      supportsToc: false,
    },
  },
};

/** Returns the given value if it is a known PresetId, otherwise DEFAULT_PRESET_ID. */
export function resolvePresetId(value: string | null | undefined): PresetId {
  if (value != null && (PRESET_IDS as readonly string[]).includes(value)) {
    return value as PresetId;
  }
  return DEFAULT_PRESET_ID;
}

/**
 * Clamp requested presentation intent to what the active preset supports.
 * Never throws - unsupported values degrade gracefully to the preset default.
 * Returns warnings for each clamped value so callers can surface them.
 */
export function resolvePresentation(
  presetId: string | null | undefined,
  requested: Presentation | null | undefined,
): ResolvedPresentationResult {
  const preset = THEME_PRESETS[resolvePresetId(presetId)].layout;
  const warnings: string[] = [];

  let resolvedLayout: PresentationLayout;
  if (requested?.layout && preset.supportedLayouts.includes(requested.layout)) {
    resolvedLayout = requested.layout;
  } else {
    if (requested?.layout) {
      warnings.push(
        `layout '${requested.layout}' is not supported by this preset; using '${preset.default.layout}'`,
      );
    }
    resolvedLayout = preset.default.layout;
  }

  let resolvedToc: boolean;
  if (requested?.toc !== undefined) {
    if (preset.supportsToc) {
      resolvedToc = requested.toc;
    } else {
      if (requested.toc === true) {
        warnings.push(`toc is not supported by this preset; toc disabled`);
      }
      resolvedToc = false;
    }
  } else {
    resolvedToc = preset.default.toc;
  }

  return {
    requested: requested ?? null,
    resolved: { layout: resolvedLayout, toc: resolvedToc },
    warnings,
  };
}

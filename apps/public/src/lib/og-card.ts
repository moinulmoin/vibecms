/**
 * Generated share (Open Graph) cards for tenant blogs.
 *
 * Pure module: no worker imports and no renderer import, so SEO meta, the
 * `/og/*` routes, and node scripts/tests share one source of truth for
 *  - the card's content version (`ogCardVersion`) that keys every cache layer
 *    and is appended to the og:image URL as `?v=`, and
 *  - the card's look (`buildOgCardModel` → `buildOgCardNode`), a Takumi node
 *    tree rendered by `server/og/og-render.ts` (lazy-loaded WASM).
 *
 * The card follows the blog's own theme (template, accent, heading font,
 * light/dark mode, radius) — never vibecms branding.
 */
import {
  getAccent,
  getFont,
  resolveMode,
  resolvePresetId,
  resolveRadius,
  resolveThemeAccent,
  resolveThemeFont,
  type FontId,
  type PresetId,
} from "@vc/config";
import { resolvePublicByline } from "./byline";

/** Bump when the card design changes so every cached card re-renders. */
export const OG_CARD_RENDER_VERSION = 1;
export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/** Snake_case site subset (matches the public SiteRow). */
export type OgCardSiteInput = {
  id?: string;
  name: string;
  theme?: string | null;
  theme_accent?: string | null;
  theme_font?: string | null;
  theme_mode?: string | null;
  theme_radius?: string | null;
  description?: string | null;
  default_seo_description?: string | null;
  byline_name?: string | null;
  show_agent_credit?: boolean | null;
};

/** Snake_case published-post subset (matches the public PostDetailRow). */
export type OgCardPostInput = {
  title: string;
  slug?: string;
  excerpt: string | null;
  seo_description?: string | null;
  published_at: number | null;
  updated_at: number | null;
  published_by_agent?: boolean | null;
};

/** Public path of a post card, or the blog-home card when `slug` is absent. */
export function ogImagePath(slug?: string | null): string {
  return slug ? `/og/${encodeURIComponent(slug)}.png` : "/og.png";
}

// ---------------------------------------------------------------------------
// Content version
// ---------------------------------------------------------------------------

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Stable 16-hex digest of everything the card shows. Any theme, byline,
 * title, excerpt, date, or host change yields a new version, so a new og:image
 * URL and a fresh cache/R2 entry; unchanged posts keep hitting the cache.
 */
export function ogCardVersion(site: OgCardSiteInput, post: OgCardPostInput | null, host: string): string {
  const parts = [
    `r${OG_CARD_RENDER_VERSION}`,
    host.toLowerCase(),
    site.name,
    site.theme ?? "",
    site.theme_accent ?? "",
    site.theme_font ?? "",
    site.theme_mode ?? "",
    site.theme_radius ?? "",
    site.byline_name ?? "",
    String(site.show_agent_credit ?? true),
  ];
  if (post) {
    parts.push(
      "post",
      post.title,
      post.seo_description || post.excerpt || "",
      String(post.published_at ?? ""),
      String(post.updated_at ?? ""),
      String(post.published_by_agent === true),
    );
  } else {
    parts.push("home", site.default_seo_description || site.description || "");
  }
  const key = parts.join("\u0000");
  return fnv1a(key, 0x811c9dc5).toString(16).padStart(8, "0") + fnv1a(key, 0x050c5d1f).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Color: the blog tokens are OKLCH; the rasterizer gets sRGB hex.
// ---------------------------------------------------------------------------

/** Convert a CSS `oklch(L% C H)` string to `#rrggbb` (gamut-clipped). */
export function oklchToHex(value: string): string {
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (!match) return "#000000";
  const lightness = match[2] === "%" ? Number(match[1]) / 100 : Number(match[1]);
  const chroma = Number(match[3]);
  const hue = (Number(match[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const c = Math.min(1, Math.max(0, channel));
      const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255).toString(16).padStart(2, "0");
    })
    .join("")}`;
}

// Mirrors the --vc-* base tokens in @vc/content vc-rich-content.css.
const PALETTES = {
  light: {
    bg: "oklch(99.2% 0.002 95)",
    fg: "oklch(21% 0.006 95)",
    muted: "oklch(49% 0.008 95)",
    hairline: "oklch(90.5% 0.004 95)",
  },
  dark: {
    bg: "oklch(16.2% 0.004 260)",
    fg: "oklch(93.5% 0.004 260)",
    muted: "oklch(71% 0.008 260)",
    hairline: "oklch(29% 0.006 260)",
  },
} as const;

// ---------------------------------------------------------------------------
// Fonts: one registered family per self-hosted variable woff2.
// ---------------------------------------------------------------------------

export type OgFontFamily = "Geist" | "Geist Mono" | "Newsreader" | "Space Grotesk" | "Hanken Grotesk";

const FONT_FAMILIES: Record<FontId, { heading: OgFontFamily; body: OgFontFamily }> = {
  "geist-sans": { heading: "Geist", body: "Geist" },
  serif: { heading: "Newsreader", body: "Newsreader" },
  grotesk: { heading: "Space Grotesk", body: "Geist" },
  humanist: { heading: "Hanken Grotesk", body: "Hanken Grotesk" },
  mono: { heading: "Geist Mono", body: "Geist" },
};

// Heading weight per template voice (see presets.css --vc-heading-weight).
const HEADING_WEIGHT: Record<PresetId, number> = {
  minimal: 650,
  editorial: 560,
  technical: 640,
  product: 720,
};

const RADIUS_PX = { none: 0, sm: 3, md: 6, lg: 10 } as const;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type OgCardModel = {
  kind: "post" | "home";
  mode: "light" | "dark";
  colors: { bg: string; fg: string; muted: string; hairline: string; accent: string };
  fonts: { heading: OgFontFamily; body: OgFontFamily };
  headingWeight: number;
  radius: number;
  siteName: string;
  host: string;
  title: string;
  titleSize: number;
  description: string | null;
  descriptionLines: number;
  /** Bottom-left line: date, and the byline/agent credit when relevant. */
  meta: string | null;
};

/** Families a model needs registered (deduplicated). */
export function ogCardFontFamilies(model: OgCardModel): OgFontFamily[] {
  return [...new Set<OgFontFamily>([model.fonts.heading, model.fonts.body])];
}

// Emoji need a color font the card doesn't ship; drop them instead of tofu.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D\u20E3]/gu;
// Scripts the self-hosted card fonts cover: Latin (incl. extended), general
// punctuation, currency, letterlike symbols. Anything else would render tofu.
const UNSUPPORTED_RE = /[^\u0000-\u024F\u0300-\u036F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\u2190-\u21FF\u2212]/u;

/**
 * Whether the card fonts can draw `value` (after emoji are dropped). Posts
 * whose title needs another script (CJK, Arabic, …) fall back to the site's
 * share image instead of a card full of missing-glyph boxes.
 */
export function ogCardTextSupported(value: string): boolean {
  return !UNSUPPORTED_RE.test(value.replace(EMOJI_RE, ""));
}

function clean(value: string | null | undefined, max: number): string {
  const text = (value ?? "").replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/[\s.,;:!?-]+\S*$/, "")}…`;
}

/** Title size steps down with length so long titles stay inside three lines. */
export function ogTitleSize(title: string, mono: boolean): number {
  const length = title.length;
  const size = length <= 28 ? 88 : length <= 52 ? 74 : length <= 80 ? 62 : length <= 110 ? 54 : 46;
  return mono ? Math.round(size * 0.86) : size;
}

function formatCardDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buildOgCardModel(site: OgCardSiteInput, post: OgCardPostInput | null, host: string): OgCardModel {
  const presetId = resolvePresetId(site.theme);
  const themeMode = resolveMode(site.theme_mode);
  // "system" has no viewer to ask, so it renders light (the default look).
  const mode = themeMode === "dark" ? "dark" : "light";
  const palette = PALETTES[mode];
  // Unset accent/font = the template's defaults, exactly as the blog renders.
  const accent = getAccent(resolveThemeAccent(site.theme_accent, presetId));
  const fontId = resolveThemeFont(site.theme_font, presetId);
  const fonts = FONT_FAMILIES[fontId] ?? FONT_FAMILIES["geist-sans"];
  const mono = fonts.heading === "Geist Mono";

  const title = clean(post ? post.title : site.name, 160) || site.name;
  const description = clean(
    post ? post.seo_description || post.excerpt : site.default_seo_description || site.description,
    220,
  );
  const titleSize = ogTitleSize(title, mono);

  let meta: string | null = null;
  if (post) {
    const byline = resolvePublicByline(site, post);
    const parts: string[] = [];
    if (post.published_at) parts.push(formatCardDate(post.published_at));
    if (byline.agent) parts.push(`Agent-written · reviewed by ${byline.name}`);
    else if (byline.name !== site.name) parts.push(`By ${byline.name}`);
    meta = parts.join(" · ") || null;
  }

  return {
    kind: post ? "post" : "home",
    mode,
    colors: {
      bg: oklchToHex(palette.bg),
      fg: oklchToHex(palette.fg),
      muted: oklchToHex(palette.muted),
      hairline: oklchToHex(palette.hairline),
      accent: oklchToHex(mode === "dark" ? accent.oklchDark : accent.oklchLight),
    },
    fonts,
    headingWeight: HEADING_WEIGHT[presetId],
    radius: RADIUS_PX[resolveRadius(site.theme_radius, presetId)],
    siteName: clean(site.name, 60),
    host: host.toLowerCase().replace(/:\d+$/, ""),
    title,
    titleSize,
    description: description || null,
    // Big titles get one line of description; short ones get two.
    descriptionLines: titleSize <= 54 ? 1 : 2,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Node tree (Takumi's container/text nodes; styles are CSS in camelCase)
// ---------------------------------------------------------------------------

type CardStyle = Record<string, string | number>;
export type OgCardNode =
  | { type: "container"; style?: CardStyle; children?: OgCardNode[] }
  | { type: "text"; text: string; style?: CardStyle };

const box = (style: CardStyle, children: OgCardNode[] = []): OgCardNode => ({ type: "container", style, children });
const text = (value: string, style: CardStyle): OgCardNode => ({ type: "text", text: value, style });

export function buildOgCardNode(model: OgCardModel): OgCardNode {
  const { colors, fonts } = model;
  const eyebrow = model.kind === "post" ? model.siteName : model.host;

  const header = box({ display: "flex", alignItems: "center", gap: 18 }, [
    box({ width: 22, height: 22, borderRadius: Math.min(model.radius, 11), backgroundColor: colors.accent }),
    text(eyebrow, {
      fontFamily: fonts.body,
      fontSize: 28,
      fontWeight: 600,
      color: colors.fg,
      letterSpacing: "-0.01em",
      lineClamp: 1,
      textOverflow: "ellipsis",
    }),
  ]);

  const titleBlock = box({ display: "flex", flexDirection: "column", gap: 26 }, [
    text(model.title, {
      fontFamily: fonts.heading,
      fontSize: model.titleSize,
      fontWeight: model.headingWeight,
      lineHeight: 1.08,
      letterSpacing: fonts.heading === "Geist Mono" ? "-0.03em" : "-0.025em",
      color: colors.fg,
      textWrap: "balance",
      lineClamp: 3,
      textOverflow: "ellipsis",
    }),
    ...(model.description
      ? [
          text(model.description, {
            fontFamily: fonts.body,
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.4,
            color: colors.muted,
            lineClamp: model.descriptionLines,
            textOverflow: "ellipsis",
            maxWidth: 940,
          }),
        ]
      : []),
  ]);

  const footer = box(
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 32,
      borderTopWidth: 2,
      borderTopStyle: "solid",
      borderTopColor: colors.hairline,
      paddingTop: 28,
    },
    [
      text(model.meta ?? "", {
        fontFamily: fonts.body,
        fontSize: 24,
        fontWeight: 500,
        color: colors.muted,
        lineClamp: 1,
        textOverflow: "ellipsis",
        flexShrink: 1,
      }),
      text(model.host, {
        fontFamily: fonts.body,
        fontSize: 24,
        fontWeight: 600,
        color: colors.accent,
        flexShrink: 0,
      }),
    ],
  );

  return box(
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      width: OG_CARD_WIDTH,
      height: OG_CARD_HEIGHT,
      padding: model.kind === "post" ? "68px 80px 60px" : "68px 80px 76px",
      backgroundColor: colors.bg,
    },
    // The home card anchors the blog name low, like a masthead on a cover.
    model.kind === "post" ? [header, titleBlock, footer] : [header, titleBlock],
  );
}

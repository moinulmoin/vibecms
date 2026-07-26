/** Bounded responsive widths for card and article media. */
export const MEDIA_RESPONSIVE_WIDTHS = [320, 640, 960, 1280] as const;

export type MediaResponsiveWidth = (typeof MEDIA_RESPONSIVE_WIDTHS)[number];

export function isAllowedMediaWidth(value: number): value is MediaResponsiveWidth {
  return (MEDIA_RESPONSIVE_WIDTHS as readonly number[]).includes(value);
}

/**
 * Parse a `?w=` query value against the allowlist.
 * Missing/empty returns null (original asset). Invalid values are rejected.
 */
export function parseMediaWidthParam(raw: string | null | undefined): MediaResponsiveWidth | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) return "invalid";
  const width = Number(raw);
  if (!Number.isInteger(width) || !isAllowedMediaWidth(width)) return "invalid";
  return width;
}

export function mediaAssetPath(assetId: string, width?: MediaResponsiveWidth): string {
  const base = `/media-assets/${assetId}`;
  return width == null ? base : `${base}?w=${width}`;
}

export type ResponsiveMediaUrls = {
  src: string;
  srcSet: string;
  widths: readonly MediaResponsiveWidth[];
};

/**
 * Deterministic original src plus srcSet variant URLs for an asset id.
 * Consumers supply their own `sizes` attribute for layout context.
 */
export function buildResponsiveMediaUrls(assetId: string): ResponsiveMediaUrls {
  const src = mediaAssetPath(assetId);
  const srcSet = MEDIA_RESPONSIVE_WIDTHS.map((width) => `${mediaAssetPath(assetId, width)} ${width}w`).join(", ");
  return {
    src,
    srcSet,
    widths: MEDIA_RESPONSIVE_WIDTHS,
  };
}

export type ResponsiveMediaAttributes = {
  src: string;
  srcSet: string;
  sizes: string;
};

/**
 * Add responsive delivery only to first-party media URLs emitted by the
 * Markdown renderer. External and already-parameterized sources pass through.
 */
export function resolveResponsiveMediaSource(
  source: string,
  sizes = "(max-width: 720px) calc(100vw - 32px), 720px",
): ResponsiveMediaAttributes | null {
  const match = /^\/media-assets\/([^/?#]+)$/.exec(source);
  if (!match?.[1]) return null;
  const urls = buildResponsiveMediaUrls(match[1]);
  return { src: urls.src, srcSet: urls.srcSet, sizes };
}

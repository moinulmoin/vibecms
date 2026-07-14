import { describe, it, expect } from 'vitest';
import {
  resolveAccent,
  resolveFont,
  resolveMode,
  getAccent,
  getFont,
  ACCENTS,
  FONTS,
  STARTER_LOOKS,
  ACCENT_IDS,
  FONT_IDS,
  DEFAULT_ACCENT_ID,
  DEFAULT_FONT_ID,
  DEFAULT_THEME_MODE,
  type AccentId,
  type FontId,
  type StarterLook,
} from '@vc/config';

// ============================================================================
// WCAG contrast utilities (local, deterministic, no network)
// ============================================================================
//
// The config stores accent colors as OKLCH strings and documents that each
// reaches >=4.5:1 against the base background in both light and dark. WCAG has
// no OKLCH input, so we convert OKLCH -> linear sRGB -> relative luminance and
// take the standard ratio. This lets the suite *compute* the ratios from the
// live ACCENTS table rather than hard-coding them, so any swatch added later is
// automatically guarded.
//
// Pipeline:
//   1. OKLCH -> OKLab (cylindrical->cartesian, a=C*cosH, b=C*sinH)
//   2. OKLab -> LMS' (linear mix), then cube -> LMS (the nonlinearity lives here)
//   3. LMS  -> linear sRGB (Björn Ottosson's published matrices)
//   4. linear sRGB -> WCAG relative luminance (linear, no gamma re-applied)
//
// NB: OKLCH->linear-sRGB yields LINEAR channel values, which is exactly what the
// WCAG luminance formula consumes. The sRGB gamma term is only for *encoded*
// hex values (used in the sanity check below), never for OKLCH output.

const WCAG_LUM_COEFFS = { r: 0.2126, g: 0.7152, b: 0.0722 };

function relativeLuminance(rLinear: number, gLinear: number, bLinear: number): number {
  // Clamp out-of-gamut negatives/overshoot so an errant channel can't distort L.
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return (
    WCAG_LUM_COEFFS.r * clamp(rLinear) +
    WCAG_LUM_COEFFS.g * clamp(gLinear) +
    WCAG_LUM_COEFFS.b * clamp(bLinear)
  );
}

function contrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** sRGB hex (gamma-encoded) -> linear channels -> relative luminance. The WCAG reference path. */
function luminanceFromHex(hex: string): number {
  const n = hex.replace('#', '');
  const channel = (i: number) => parseInt(n.slice(i * 2, i * 2 + 2), 16) / 255;
  const decodeSRGB = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return relativeLuminance(decodeSRGB(channel(0)), decodeSRGB(channel(1)), decodeSRGB(channel(2)));
}

/** Parse an "oklch(L% C H)" string into linear sRGB channels. */
function oklchToLinearSrgb(oklch: string): [number, number, number] {
  const inner = oklch.slice(oklch.indexOf('(') + 1, oklch.lastIndexOf(')'));
  const [lTok, cTok, hTok] = inner.trim().split(/\s+/);
  const L = lTok.endsWith('%') ? parseFloat(lTok) / 100 : parseFloat(lTok);
  const C = parseFloat(cTok);
  const H = parseFloat(hTok);
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380041 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminanceFromOklch(oklch: string): number {
  const [r, g, b] = oklchToLinearSrgb(oklch);
  return relativeLuminance(r, g, b);
}

// Base backgrounds documented on the accent swatches in packages/config.
const BG_LIGHT = 'oklch(98.7% 0.004 106)';
const BG_DARK = 'oklch(15% 0.008 168)';

// ============================================================================
// Contrast converter self-certification
// ============================================================================

describe('contrast converter (self-check)', () => {
  // Pin the OKLCH->luminance matrix at both endpoints: pure white/black must be
  // exactly 1.0 / 0.0. If these drift, the OKLab matrix is wrong.
  it('maps oklch white (L=100%) to relative luminance 1.0', () => {
    expect(luminanceFromOklch('oklch(100% 0 0)')).toBeCloseTo(1.0, 10);
  });

  it('maps oklch black (L=0%) to relative luminance 0.0', () => {
    expect(luminanceFromOklch('oklch(0% 0 0)')).toBeCloseTo(0.0, 10);
  });

  // Known WCAG reference pair: #767676 on #ffffff is the canonical AA threshold
  // gray (~4.54:1). This exercises the sRGB gamma path + ratio math together.
  it('computes #767676 on #ffffff ~= 4.54:1 (WCAG AA threshold gray)', () => {
    const ratio = contrastRatio(luminanceFromHex('#767676'), luminanceFromHex('#ffffff'));
    expect(ratio).toBeGreaterThanOrEqual(4.48);
    expect(ratio).toBeLessThanOrEqual(4.56);
  });

  it('computes pure black on white as the 21:1 maximum', () => {
    expect(contrastRatio(luminanceFromHex('#000000'), luminanceFromHex('#ffffff'))).toBeCloseTo(
      21.0,
      6,
    );
  });
});

// ============================================================================
// Resolver tests
// ============================================================================

describe('resolveAccent', () => {
  it.each(ACCENT_IDS as readonly AccentId[])('returns %s for a known accent id', (id) => {
    expect(resolveAccent(id)).toBe(id);
  });

  it.each(['not-an-accent', '', 'teal ', 'TEAL'])(
    'falls back to DEFAULT_ACCENT_ID (%s) for an unknown/invalid string',
    (bad) => {
      expect(resolveAccent(bad)).toBe(DEFAULT_ACCENT_ID);
    },
  );

  it('falls back to DEFAULT_ACCENT_ID for null', () => {
    expect(resolveAccent(null)).toBe(DEFAULT_ACCENT_ID);
  });

  it('falls back to DEFAULT_ACCENT_ID for undefined', () => {
    expect(resolveAccent(undefined)).toBe(DEFAULT_ACCENT_ID);
  });

  it('documents the default as teal', () => {
    expect(DEFAULT_ACCENT_ID).toBe('teal');
  });
});

describe('resolveFont', () => {
  it.each(FONT_IDS as readonly FontId[])('returns %s for a known font id', (id) => {
    expect(resolveFont(id)).toBe(id);
  });

  it.each(['nope', '', 'geist'])(
    'falls back to DEFAULT_FONT_ID for an unknown/invalid string',
    (bad) => {
      expect(resolveFont(bad)).toBe(DEFAULT_FONT_ID);
    },
  );

  it('falls back to DEFAULT_FONT_ID for null', () => {
    expect(resolveFont(null)).toBe(DEFAULT_FONT_ID);
  });

  it('falls back to DEFAULT_FONT_ID for undefined', () => {
    expect(resolveFont(undefined)).toBe(DEFAULT_FONT_ID);
  });

  it('documents the default as geist-sans', () => {
    expect(DEFAULT_FONT_ID).toBe('geist-sans');
  });
});

describe('resolveMode', () => {
  it.each(['light', 'dark', 'system'])('returns %s for a known mode', (mode) => {
    expect(resolveMode(mode)).toBe(mode);
  });

  it.each(['auto', '', 'light-dark', 'LIGHT'])(
    'falls back to DEFAULT_THEME_MODE for an unknown/invalid string',
    (bad) => {
      expect(resolveMode(bad)).toBe(DEFAULT_THEME_MODE);
    },
  );

  it('falls back to DEFAULT_THEME_MODE for null', () => {
    expect(resolveMode(null)).toBe(DEFAULT_THEME_MODE);
  });

  it('falls back to DEFAULT_THEME_MODE for undefined', () => {
    expect(resolveMode(undefined)).toBe(DEFAULT_THEME_MODE);
  });

  it('documents the default as system', () => {
    expect(DEFAULT_THEME_MODE).toBe('system');
  });
});

describe('getAccent / getFont unknown-id fallback', () => {
  it('getAccent returns the default (teal) swatch for an unknown id', () => {
    const swatch = getAccent('definitely-not-an-accent' as AccentId);
    expect(swatch.id).toBe(DEFAULT_ACCENT_ID);
    expect(ACCENTS.map((a) => a.id)).toContain(swatch.id);
  });

  it('getFont returns the default (geist-sans) pairing for an unknown id', () => {
    const font = getFont('definitely-not-a-font' as FontId);
    expect(font.id).toBe(DEFAULT_FONT_ID);
    expect(FONTS.map((f) => f.id)).toContain(font.id);
  });

  it('getAccent returns the exact record for a known id', () => {
    const swatch = getAccent('rust');
    expect(swatch).toEqual(ACCENTS.find((a) => a.id === 'rust'));
  });

  it('getFont returns the exact record for a known id', () => {
    const font = getFont('serif');
    expect(font).toEqual(FONTS.find((f) => f.id === 'serif'));
  });
});

// ============================================================================
// AA contrast: every accent must reach >=4.5:1 on BOTH base backgrounds
// ============================================================================

describe('ACCENTS WCAG AA contrast (>=4.5:1 in light AND dark)', () => {
  // Structural floor first: every swatch must declare both color variants so the
  // ratio loop has something to convert. Catches a half-defined swatch.
  it.each(ACCENTS)(
    '$id defines non-empty oklchLight and oklchDark',
    ({ id, oklchLight, oklchDark }) => {
      expect(oklchLight, `${id}.oklchLight`).toMatch(/^oklch\(/);
      expect(oklchDark, `${id}.oklchDark`).toMatch(/^oklch\(/);
    },
  );

  // The real guard: compute the ratio for every accent x mode from the live
  // ACCENTS table. Iterating the array (not a hardcoded list) means a swatch
  // added later is automatically required to pass AA.
  it.each(ACCENTS)(
    '$id reaches >=4.5:1 against the LIGHT base (oklchLight on bgLight)',
    ({ id, oklchLight }) => {
      const ratio = contrastRatio(luminanceFromOklch(oklchLight), luminanceFromOklch(BG_LIGHT));
      expect(ratio, `${id} light-mode ratio`).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(ACCENTS)(
    '$id reaches >=4.5:1 against the DARK base (oklchDark on bgDark)',
    ({ id, oklchDark }) => {
      const ratio = contrastRatio(luminanceFromOklch(oklchDark), luminanceFromOklch(BG_DARK));
      expect(ratio, `${id} dark-mode ratio`).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Sanity net: confirm the base backgrounds themselves resolve to extreme
  // luminances so a regressed bg constant can't silently pass the loop above.
  it('the LIGHT base is near-white and the DARK base is near-black', () => {
    expect(luminanceFromOklch(BG_LIGHT)).toBeGreaterThan(0.9);
    expect(luminanceFromOklch(BG_DARK)).toBeLessThan(0.05);
  });
});

// ============================================================================
// STARTER_LOOKS integrity
// ============================================================================

describe('STARTER_LOOKS reference valid accent and font ids', () => {
  const starters = Object.entries(STARTER_LOOKS) as [string, StarterLook][];

  it.each(starters)('starter look %s references a known accent id', (name, look) => {
    expect(ACCENT_IDS, `${name}.accent "${look.accent}" is not in ACCENTS`).toContain(
      look.accent,
    );
  });

  it.each(starters)(
    'starter look %s references a known font id when a font is set',
    (name, look) => {
      if (look.font === undefined) return; // font is optional on StarterLook
      expect(FONT_IDS, `${name}.font "${look.font}" is not in FONTS`).toContain(look.font);
    },
  );

  it('covers exactly the documented starters (editorial/technical/product)', () => {
    expect(Object.keys(STARTER_LOOKS).sort()).toEqual(['editorial', 'product', 'technical']);
  });
});

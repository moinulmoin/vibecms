import { describe, it, expect } from 'vitest';
import { resolvePresentation } from '@vc/config';

// Preset defaults (from packages/config): every preset supports every layout
// and the page-level ToC; they differ only in defaults.
//   minimal:   { layout: 'standard', toc: true }
//   editorial: { layout: 'essay',    toc: true }
//   technical: { layout: 'standard', toc: true }
//   product:   { layout: 'feature',  toc: false }

describe('resolvePresentation', () => {
  // ─── null / undefined input ─────────────────────────────────────────────────

  describe('null / undefined requested', () => {
    it('returns requested:null and the preset default when requested is null', () => {
      const r = resolvePresentation('minimal', null);
      expect(r.requested).toBeNull();
      expect(r.resolved).toEqual({ layout: 'standard', toc: true });
      expect(r.warnings).toHaveLength(0);
    });

    it('returns requested:null and the preset default when requested is undefined', () => {
      const r = resolvePresentation('editorial', undefined);
      expect(r.requested).toBeNull();
      expect(r.resolved).toEqual({ layout: 'essay', toc: true });
      expect(r.warnings).toHaveLength(0);
    });

    it('falls back to the default preset (minimal) for an unknown presetId', () => {
      const r = resolvePresentation('not-a-real-preset', null);
      expect(r.requested).toBeNull();
      // resolvePresetId falls back to 'minimal' (DEFAULT_PRESET_ID)
      expect(r.resolved).toEqual({ layout: 'standard', toc: true });
      expect(r.warnings).toHaveLength(0);
    });
  });

  // ─── unsupported layout clamps to preset default + warning ──────────────────

  describe('unsupported layout', () => {
    it('clamps an unsupported layout to the preset default and pushes a warning', () => {
      // Unknown layout values (e.g. from an old agent) clamp to the preset default.
      const r = resolvePresentation('minimal', { layout: 'grid' as never });
      expect(r.resolved.layout).toBe('standard');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/layout.*grid.*not supported/);
    });

    it('clamps an unsupported layout on the product preset', () => {
      const r = resolvePresentation('product', { layout: 'magazine' as never });
      expect(r.resolved.layout).toBe('feature'); // product default
      expect(r.warnings).toHaveLength(1);
    });

    it('stores the original requested value even when the layout is clamped', () => {
      const r = resolvePresentation('minimal', { layout: 'grid' as never });
      expect(r.requested).toEqual({ layout: 'grid' });
    });
  });

  // ─── toc:true clamps to false + warning when !supportsToc ───────────────────

  describe('toc is honored on every preset', () => {
    it('keeps toc:true on minimal and product without warnings', () => {
      for (const preset of ['minimal', 'product']) {
        const r = resolvePresentation(preset, { toc: true });
        expect(r.resolved.toc).toBe(true);
        expect(r.warnings).toHaveLength(0);
      }
    });

    it('lets a post opt out of the default toc', () => {
      const r = resolvePresentation('minimal', { toc: false });
      expect(r.resolved.toc).toBe(false);
      expect(r.warnings).toHaveLength(0);
    });
  });

  // ─── supported values pass through with no warning ──────────────────────────

  describe('supported layout and toc pass through cleanly', () => {
    it('accepts a supported layout with no warning (editorial - essay)', () => {
      const r = resolvePresentation('editorial', { layout: 'essay' });
      expect(r.resolved.layout).toBe('essay');
      expect(r.warnings).toHaveLength(0);
    });

    it('accepts layout:standard on editorial (also supported)', () => {
      const r = resolvePresentation('editorial', { layout: 'standard' });
      expect(r.resolved.layout).toBe('standard');
      expect(r.warnings).toHaveLength(0);
    });

    it('accepts toc:true on editorial (supportsToc)', () => {
      const r = resolvePresentation('editorial', { toc: true });
      expect(r.resolved.toc).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('accepts toc:true on technical (supportsToc)', () => {
      const r = resolvePresentation('technical', { toc: true });
      expect(r.resolved.toc).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('accepts supported layout + toc together with no warning', () => {
      const r = resolvePresentation('editorial', { layout: 'standard', toc: true });
      expect(r.resolved).toEqual({ layout: 'standard', toc: true });
      expect(r.warnings).toHaveLength(0);
    });

    it('stores the exact requested object when values are valid', () => {
      const requested = { layout: 'essay' as const, toc: true };
      const r = resolvePresentation('editorial', requested);
      expect(r.requested).toEqual(requested);
    });
  });
});

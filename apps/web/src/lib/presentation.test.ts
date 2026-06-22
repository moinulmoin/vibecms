import { describe, it, expect } from 'vitest';
import { resolvePresentation } from '@vc/config';

// Preset defaults (from packages/config):
//   minimal:   { layout: 'standard', toc: false }, supportedLayouts: ['standard'],          supportsToc: false
//   editorial: { layout: 'essay',    toc: false }, supportedLayouts: ['standard', 'essay'], supportsToc: true
//   technical: { layout: 'standard', toc: false }, supportedLayouts: ['standard'],          supportsToc: true
//   product:   { layout: 'feature',  toc: false }, supportedLayouts: ['standard','feature'],supportsToc: false

describe('resolvePresentation', () => {
  // ─── null / undefined input ─────────────────────────────────────────────────

  describe('null / undefined requested', () => {
    it('returns requested:null and the preset default when requested is null', () => {
      const r = resolvePresentation('minimal', null);
      expect(r.requested).toBeNull();
      expect(r.resolved).toEqual({ layout: 'standard', toc: false });
      expect(r.warnings).toHaveLength(0);
    });

    it('returns requested:null and the preset default when requested is undefined', () => {
      const r = resolvePresentation('editorial', undefined);
      expect(r.requested).toBeNull();
      expect(r.resolved).toEqual({ layout: 'essay', toc: false });
      expect(r.warnings).toHaveLength(0);
    });

    it('falls back to the default preset (minimal) for an unknown presetId', () => {
      const r = resolvePresentation('not-a-real-preset', null);
      expect(r.requested).toBeNull();
      // resolvePresetId falls back to 'minimal' (DEFAULT_PRESET_ID)
      expect(r.resolved).toEqual({ layout: 'standard', toc: false });
      expect(r.warnings).toHaveLength(0);
    });
  });

  // ─── unsupported layout clamps to preset default + warning ──────────────────

  describe('unsupported layout', () => {
    it('clamps an unsupported layout to the preset default and pushes a warning', () => {
      // minimal only supports 'standard'; 'feature' is unsupported
      const r = resolvePresentation('minimal', { layout: 'feature' });
      expect(r.resolved.layout).toBe('standard');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/layout.*feature.*not supported/);
    });

    it('clamps an unsupported layout on the product preset', () => {
      // product supports ['standard', 'feature']; 'essay' is not in that list
      const r = resolvePresentation('product', { layout: 'essay' });
      expect(r.resolved.layout).toBe('feature'); // product default
      expect(r.warnings).toHaveLength(1);
    });

    it('stores the original requested value even when the layout is clamped', () => {
      const r = resolvePresentation('minimal', { layout: 'feature' });
      expect(r.requested).toEqual({ layout: 'feature' });
    });
  });

  // ─── toc:true clamps to false + warning when !supportsToc ───────────────────

  describe('toc:true on a preset that does not support TOC', () => {
    it('clamps toc:true to false and pushes a warning for the minimal preset', () => {
      const r = resolvePresentation('minimal', { toc: true });
      expect(r.resolved.toc).toBe(false);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/toc.*not supported/);
    });

    it('clamps toc:true to false and pushes a warning for the product preset', () => {
      const r = resolvePresentation('product', { toc: true });
      expect(r.resolved.toc).toBe(false);
      expect(r.warnings).toHaveLength(1);
    });

    it('does NOT warn when toc:false is passed to a preset that does not support TOC', () => {
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

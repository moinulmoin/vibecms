import { describe, it, expect } from 'vitest';
import { readingTimeMinutes } from './reading-time';

// readingTimeMinutes(markdown) = Math.max(1, Math.ceil(words / 225))
// where words = markdown.split(/\s+/).filter(Boolean).length
// (whitespace-split, empties dropped — mirrors the renderer's own heuristic,
//  so markdown syntax characters count as words).

const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');

describe('readingTimeMinutes', () => {
  // ─── 1-minute floor ──────────────────────────────────────────────────────

  describe('1-minute floor', () => {
    it('returns 1 for an empty string (0 words)', () => {
      expect(readingTimeMinutes('')).toBe(1);
    });

    it('returns 1 for whitespace-only input (0 non-empty tokens)', () => {
      expect(readingTimeMinutes('   \n\t  ')).toBe(1);
    });

    it('returns 1 for a short sentence (well under one minute of reading)', () => {
      expect(readingTimeMinutes('one two')).toBe(1);
    });
  });

  // ─── ceil boundary at 225 words per minute ───────────────────────────────
  // The 225/226 pair is the load-bearing boundary: 225 is the largest input
  // that still rounds down to 1; 226 is the smallest that rounds up to 2.

  describe('ceil boundary (225 words per minute)', () => {
    it('exactly 225 words -> 1 minute (ceil(225/225) = 1)', () => {
      expect(readingTimeMinutes(words(225))).toBe(1);
    });

    it('226 words -> 2 minutes (first input past the boundary)', () => {
      expect(readingTimeMinutes(words(226))).toBe(2);
    });

    it('450 words -> 2 minutes (ceil(450/225) = 2)', () => {
      expect(readingTimeMinutes(words(450))).toBe(2);
    });

    it('1125 words -> 5 minutes (ceil(1125/225) = 5)', () => {
      expect(readingTimeMinutes(words(1125))).toBe(5);
    });
  });

  // ─── realistic markdown input ────────────────────────────────────────────
  // Guards that the naive whitespace tokenizer survives real markdown and that
  // the floor holds for a typical short document. The fixture has exactly 32
  // whitespace-separated tokens — heading markers ('#', '##'), the code-fence
  // delimiter ('```ts'), and punctuation are all counted, matching the
  // documented "word counting mirrors the renderer's heuristic" invariant.

  describe('realistic markdown input', () => {
    const REALISTIC = [
      '# Building a Theme',
      '',
      'This is the **introduction** paragraph, with some punctuation!',
      '',
      '## Getting Started',
      '',
      'Install the package, then configure it.',
      '',
      '```ts',
      'const x = compute(42);',
      '```',
      '',
      '## Conclusion',
      '',
      "That's all, folks.",
    ].join('\n');

    it('counts 32 whitespace tokens (markdown syntax included)', () => {
      expect(REALISTIC.split(/\s+/).filter(Boolean).length).toBe(32);
    });

    it('a realistic ~32-word document floors to 1 minute', () => {
      expect(readingTimeMinutes(REALISTIC)).toBe(1);
    });
  });
});

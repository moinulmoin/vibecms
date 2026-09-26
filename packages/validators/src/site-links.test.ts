import { describe, expect, it } from 'vitest';
import { navLinksSchema, socialLinksSchema } from './site';

describe('site links', () => {
  it('limits navigation rows and rejects unsafe schemes', () => {
    expect(navLinksSchema.safeParse(Array.from({ length: 7 }, () => ({ label: 'Link', url: '/about' }))).success).toBe(false);
    expect(navLinksSchema.safeParse([{ label: 'x'.repeat(41), url: '/about' }]).success).toBe(false);
    expect(navLinksSchema.safeParse([{ label: 'Good', url: 'javascript:alert(1)' }]).success).toBe(false);
    expect(navLinksSchema.safeParse([{ label: 'Bad', url: '//evil.test' }]).success).toBe(false);
    expect(navLinksSchema.safeParse([{ label: 'Email', url: 'mailto:hello@example.com' }]).success).toBe(true);
  });
  it('checks social kinds, limits, and normalizes email', () => {
    expect(socialLinksSchema.safeParse(Array.from({ length: 9 }, () => ({ kind: 'github', url: 'https://github.com/a' }))).success).toBe(false);
    expect(socialLinksSchema.safeParse([{ kind: 'other', url: 'https://example.com' }]).success).toBe(false);
    expect(socialLinksSchema.safeParse([{ kind: 'github', url: 'http://github.com/a' }]).success).toBe(false);
    expect(socialLinksSchema.parse([{ kind: 'email', url: 'hi@example.com' }])[0]?.url).toBe('mailto:hi@example.com');
  });
});

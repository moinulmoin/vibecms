import { expect, it } from 'vitest';
import { mapSiteRow, siteDtoSchema } from './index';

it('sites.get exposes read-only identity URLs and validated links', () => {
  const site = mapSiteRow({
    id: 'site', name: 'Site', slug: 'site', description: null,
    voiceSeedJson: '[]', logoAssetId: 'logo', faviconAssetId: 'favicon',
    navLinksJson: '[{"label":"About","url":"/about"}]',
    socialLinksJson: '[{"kind":"email","url":"hello@example.com"}]',
    createdAt: 1, updatedAt: 2,
  }, 'https://blog.example.com');
  expect(siteDtoSchema.parse(site)).toMatchObject({
    logoUrl: 'https://blog.example.com/media-assets/logo',
    faviconUrl: 'https://blog.example.com/media-assets/favicon',
    navLinks: [{ label: 'About', url: '/about' }],
    socialLinks: [{ kind: 'email', url: 'mailto:hello@example.com' }],
  });
});

/// <reference types="@cloudflare/vitest-pool-workers" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, expect, inject, it } from 'vitest'
import { updateSignupFormRequestSchema } from '@vc/api-contract'
import { handleSubscribe } from './subscribe'

declare module 'vitest' {
  interface ProvidedContext { migrations: D1Migration[] }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations'))
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind('ws-external-news', 'External', 'ws-external-news', 1700000000, 1700000000).run()
  await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, newsletter_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('site-external-news', 'ws-external-news', 'External', 'external-news', JSON.stringify({ enabled: true, heading: 'Updates', subtext: 'Subscribe for updates.', buttonLabel: 'Subscribe', externalForm: { action: 'https://buttondown.com/api/emails/embed-subscribe/example', emailField: 'email' } }), 1700000000, 1700000000).run()
})

it('does not store stale vibecms signups after an external form is connected and rejects insecure actions', async () => {
  expect(updateSignupFormRequestSchema.safeParse({ expectedUpdatedAt: 1, externalForm: { action: 'http://buttondown.com/form', emailField: 'email' } }).success).toBe(false)
  const response = await handleSubscribe(new Request('https://app.basedui.dev/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.11' }, body: JSON.stringify({ siteSlug: 'external-news', email: 'reader@example.com' }) }))
  expect(response.status).toBe(200)
  const row = await env.DB.prepare('SELECT id FROM subscribers WHERE site_id = ? AND email = ?').bind('site-external-news', 'reader@example.com').first()
  expect(row).toBeNull()
})

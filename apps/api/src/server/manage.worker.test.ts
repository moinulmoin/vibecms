/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { AGENT_TOKEN_PRESETS, type Actor } from '@vc/core'
import { app } from '@/index'
import { createApiKeyForApp, hashApiToken } from './api-keys'
import { handleMcpRequest } from './mcp'
import { getSiteSettings, updateSiteSettingsForApp, type AppUserContext } from './onboarding'
import { getSiteOp, getThemeOp, listTagsOp, updateSiteOp, updateThemeOp, revertThemeOp, updateVoiceOp, updateSignupFormOp, getAnalyticsOp, schedulePostOp, type OperationContext } from './operations'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

const workspaceId = 'manage-test-workspace'
const siteId = 'manage-test-site'
const paidWorkspaceId = 'manage-test-paid-workspace'
const paidSiteId = 'manage-test-paid-site'
const tokens = {
  draft: `vc_test_manage_draft_${'a'.repeat(32)}`,
  publish: `vc_test_manage_publish_${'b'.repeat(32)}`,
  manage: `vc_test_manage_manage_${'c'.repeat(32)}`,
  paid: `vc_test_manage_paid_${'d'.repeat(32)}`,
}
const actor: Actor = { type: 'api_key', id: 'manage-test-key-manage', name: 'Site Agent', scopes: AGENT_TOKEN_PRESETS.manage }
const ctx: OperationContext = { actor, siteId, workspaceId, tokenId: actor.id }
const owner: AppUserContext = {
  actor: { type: 'human', id: 'manage-test-owner', name: 'Owner', role: 'owner' },
  user: { id: 'manage-test-owner', name: 'Owner', email: 'owner@manage.test' },
  siteId, workspaceId,
}

async function request(token: string, method: string, path: string, body?: unknown) {
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
  return app.fetch(new Request(`https://app.vibecms.dev/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const t = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, 'Manage', workspaceId, t, t),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(siteId, workspaceId, 'Original', siteId, t, t),
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(paidWorkspaceId, 'Paid Manage', paidWorkspaceId, t, t),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(paidSiteId, paidWorkspaceId, 'Paid', paidSiteId, t, t),
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').bind('manage-test-owner', 'Owner', 'owner@manage.test', t, t),
  ])
  for (const preset of ['draft', 'publish', 'manage'] as const) {
    await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
      created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`manage-test-key-${preset}`, siteId, preset === 'manage' ? 'Site Agent' : preset, tokens[preset].slice(0, 18),
        await hashApiToken(tokens[preset], env.TOKEN_PEPPER), JSON.stringify(AGENT_TOKEN_PRESETS[preset]),
        preset === 'manage' ? 'Different actor label' : preset, 'manage-test-owner', t, t).run()
  }
  await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
    created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('manage-test-paid-key', paidSiteId, 'Paid key', tokens.paid.slice(0, 18), await hashApiToken(tokens.paid, env.TOKEN_PEPPER), JSON.stringify(AGENT_TOKEN_PRESETS.manage), 'Paid Agent', 'manage-test-owner', t, t).run()
  await env.DB.prepare(`INSERT INTO autoseopilot_managed_sites (id, external_workspace_id, owner_user_id, workspace_id, site_id,
    credential_id, credential_generation, api_key_id, entitlement_status, lifecycle_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', 1, ?, ?)`)
    .bind('manage-test-entitlement', 'manage-test-external', 'manage-test-owner', paidWorkspaceId, paidSiteId,
      'manage-test-credential', 'manage-test-paid-key', t, t).run()
})

describe('Manage key', () => {
  it('issues the Manage preset without changing scopes on existing keys', async () => {
    const before = await env.DB.prepare("SELECT id, scopes_json AS scopes FROM api_keys WHERE site_id = ? AND id IN ('manage-test-key-draft', 'manage-test-key-publish') ORDER BY id")
      .bind(siteId).all<{ id: string; scopes: string }>()
    const created = await createApiKeyForApp(owner, { name: 'New manager', actorName: 'New manager', preset: 'manage' })
    expect(created.kind).toBe('ok')
    if (created.kind !== 'ok') return
    const row = await env.DB.prepare('SELECT scopes_json AS scopes FROM api_keys WHERE id = ?')
      .bind(created.id).first<{ scopes: string }>()
    expect(JSON.parse(row!.scopes)).toEqual(AGENT_TOKEN_PRESETS.manage)
    const after = await env.DB.prepare("SELECT id, scopes_json AS scopes FROM api_keys WHERE site_id = ? AND id IN ('manage-test-key-draft', 'manage-test-key-publish') ORDER BY id")
      .bind(siteId).all<{ id: string; scopes: string }>()
    expect(after.results).toEqual(before.results)
  })

  it('returns 403 to Drafts and Publish keys for every new REST operation', async () => {
    const updatedAt = (await getSiteSettings(owner)).updatedAt
    const cases: Array<[string, string, unknown?]> = [
      ['PATCH', '/site', { expectedUpdatedAt: updatedAt, name: 'Nope' }],
      ['GET', '/site/theme'],
      ['PATCH', '/site/theme', { expectedUpdatedAt: updatedAt, accent: 'blue' }],
      ['POST', '/site/theme/revert', { expectedUpdatedAt: updatedAt }],
      ['PUT', '/site/voice', { expectedUpdatedAt: 0, audience: 'Readers', tone: 'Clear', doRules: [], dontRules: [], representativePostIds: [] }],
      ['PATCH', '/site/signup-form', { expectedUpdatedAt: updatedAt, heading: 'Join' }],
      ['GET', '/tags'],
      ['GET', '/analytics?range=7'],
    ]
    for (const token of [tokens.draft, tokens.publish]) {
      for (const [method, path, body] of cases) {
        const response = await request(token, method, path, body)
        expect(response.status, `${method} ${path}`).toBe(403)
        expect((await response.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
      }
    }
  })

  it('accepts every new REST operation with a Manage key', async () => {
    let updatedAt = (await getSiteSettings(owner)).updatedAt
    const site = await request(tokens.manage, 'PATCH', '/site', { expectedUpdatedAt: updatedAt, description: 'A new description' })
    expect(site.status).toBe(200)
    expect((await site.json() as { settings: { description: string } }).settings.description).toBe('A new description')
    const attribution = await env.DB.prepare("SELECT actor_name AS actorName FROM activity_events WHERE site_id = ? AND action = 'site.updated' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ actorName: string }>()
    expect(attribution?.actorName).toBe('Site Agent')
    const siteEvent = await env.DB.prepare("SELECT before_json AS beforeJson, after_json AS afterJson FROM activity_events WHERE site_id = ? AND action = 'site.updated' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ beforeJson: string; afterJson: string }>()
    expect(JSON.parse(siteEvent!.afterJson)).toEqual({ description: 'A new description' })
    expect(JSON.parse(siteEvent!.beforeJson)).toHaveProperty('description')
    const stale = await request(tokens.manage, 'PATCH', '/site', { expectedUpdatedAt: updatedAt, name: 'Stale' })
    expect(stale.status).toBe(409)
    expect((await stale.json() as { error: { code: string } }).error.code).toBe('CONFLICT')
    const themeGet = await request(tokens.manage, 'GET', '/site/theme')
    expect(themeGet.status).toBe(200)
    updatedAt = (await themeGet.json() as { updatedAt: number }).updatedAt
    const themeUpdate = await request(tokens.manage, 'PATCH', '/site/theme', { expectedUpdatedAt: updatedAt, accent: 'blue' })
    expect(themeUpdate.status).toBe(200)
    const themeEvent = await env.DB.prepare("SELECT summary, before_json AS beforeJson, after_json AS afterJson FROM activity_events WHERE site_id = ? AND summary = 'Changed the theme' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ summary: string; beforeJson: string; afterJson: string }>()
    expect(themeEvent?.summary).toBe('Changed the theme')
    expect(JSON.parse(themeEvent!.afterJson)).toHaveProperty('themeAccent')
    updatedAt = (await themeUpdate.json() as { updatedAt: number }).updatedAt
    const themeRevert = await request(tokens.manage, 'POST', '/site/theme/revert', { expectedUpdatedAt: updatedAt })
    expect(themeRevert.status).toBe(200)
    const voiceRevision = (await getSiteOp(ctx))!.voiceProfile.revision
    const voice = await request(tokens.manage, 'PUT', '/site/voice', { expectedUpdatedAt: voiceRevision, audience: 'Readers', tone: 'Clear', doRules: [], dontRules: [], representativePostIds: [] })
    expect(voice.status).toBe(200)
    const signup = await request(tokens.manage, 'PATCH', '/site/signup-form', { expectedUpdatedAt: (await getSiteSettings(owner)).updatedAt, heading: 'Join us' })
    expect(signup.status).toBe(200)
    const signupEvent = await env.DB.prepare("SELECT before_json AS beforeJson, after_json AS afterJson FROM activity_events WHERE site_id = ? AND summary = 'Updated the signup form' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ beforeJson: string; afterJson: string }>()
    expect(JSON.parse(signupEvent!.afterJson)).toEqual({ heading: 'Join us' })
    expect(JSON.parse(signupEvent!.beforeJson)).toHaveProperty('heading')
    const tags = await request(tokens.manage, 'GET', '/tags')
    expect(tags.status).toBe(200)
    expect(await tags.json()).toEqual([])
    const analytics = await request(tokens.paid, 'GET', '/analytics?range=30')
    expect(analytics.status).toBe(200)
    expect(await analytics.json()).toMatchObject({ status: 'unavailable', reason: 'not_configured' })
    const free = await request(tokens.manage, 'GET', '/analytics?range=30')
    expect(free.status).toBe(402)
    expect((await free.json() as { error: { code: string } }).error.code).toBe('ANALYTICS_PAID_PLAN')
  })

  it('dispatches Manage tools through MCP with the same scope enforcement', async () => {
    const call = (token: string) => handleMcpRequest(new Request('https://app.vibecms.dev/mcp', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'sites.theme.get', arguments: {} } }),
    }))
    await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
    const denied = await call(tokens.publish)
    expect(denied.status).toBe(200)
    const deniedJson = await denied.json() as { result: { isError: boolean; structuredContent: { code: string }; content: Array<{ text: string }> } }
    expect(deniedJson).toMatchObject({ result: { isError: true, structuredContent: { code: 'FORBIDDEN' } } })
    expect(JSON.parse(deniedJson.result.content[0]!.text)).toMatchObject({ code: 'FORBIDDEN' })
    await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
    const allowed = await call(tokens.manage)
    expect(allowed.status).toBe(200)
    const allowedJson = await allowed.json() as { result: Record<string, unknown> }
    expect(allowedJson).toMatchObject({ result: { structuredContent: { template: expect.any(String) } } })
    expect(allowedJson.result).not.toHaveProperty('outputSchema')
  })

  it('uses dashboard site validation and patch semantics, returns 409 on stale writes, and attributes activity', async () => {
    const original = await getSiteSettings(owner)
    const payload = { expectedUpdatedAt: original.updatedAt, name: 'Field Notes', bylineName: 'Alex',
      defaultSeoTitle: 'Field Notes SEO', navLinks: [{ label: 'About', url: '/about' }] }
    const agentResult = await updateSiteOp(ctx, payload)
    expect(agentResult.settings).toMatchObject({ name: 'Field Notes', bylineName: 'Alex', defaultSeoTitle: 'Field Notes SEO', navLinks: payload.navLinks })
    const agentStored = await getSiteSettings(owner)
    expect(agentStored.description).toBe(original.description)
    const activity = await env.DB.prepare("SELECT actor_name AS actorName, actor_type AS actorType FROM activity_events WHERE site_id = ? AND action = 'site.updated' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ actorName: string; actorType: string }>()
    expect(activity).toEqual({ actorName: 'Site Agent', actorType: 'api_key' })
    await expect(updateSiteOp(ctx, payload)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    const dashboardResult = await updateSiteSettingsForApp(owner, { ...payload, expectedUpdatedAt: agentStored.updatedAt })
    expect(dashboardResult).toEqual({ kind: 'ok', code: 'site_saved' })
    const dashboardStored = await getSiteSettings(owner)
    expect({ ...agentStored, updatedAt: 0 }).toEqual({ ...dashboardStored, updatedAt: 0 })
  })

  it('returns the written site to a key with site:write but no sites:read', async () => {
    const writeOnly: OperationContext = { ...ctx, actor: { ...actor, scopes: ['site:write'] } }
    const expectedUpdatedAt = (await getSiteSettings(owner)).updatedAt
    const result = await updateSiteOp(writeOnly, { expectedUpdatedAt, description: 'Visible to the writer' })
    expect(result.settings.description).toBe('Visible to the writer')
    expect(result.description).toBe('Visible to the writer')
  })

  it('rejects stale signup patches and preserves fields omitted by a later patch', async () => {
    const expectedUpdatedAt = (await getSiteSettings(owner)).updatedAt
    await updateSignupFormOp(ctx, { expectedUpdatedAt, heading: 'First heading' })
    await expect(updateSignupFormOp(ctx, { expectedUpdatedAt, button: 'Stale button' }))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    const nextRevision = (await getSiteSettings(owner)).updatedAt
    const result = await updateSignupFormOp(ctx, { expectedUpdatedAt: nextRevision, button: 'Fresh button' })
    expect(result).toMatchObject({ heading: 'First heading', button: 'Fresh button' })
  })

  it('applies curated template defaults, keeps the look on request, then restores the exact raw previous look', async () => {
    const before = await env.DB.prepare('SELECT theme, theme_accent AS accent, theme_font AS font, theme_radius AS radius, theme_width AS width, theme_mode AS mode FROM sites WHERE id = ?')
      .bind(siteId).first()
    const current = await getThemeOp(ctx)
    const changed = await updateThemeOp(ctx, { expectedUpdatedAt: current.updatedAt, template: 'editorial' })
    expect(changed.template).toBe('editorial')
    expect(changed.accent).toBe('rust')
    expect(changed.canRevert).toBe(true)
    const reverted = await revertThemeOp(ctx, { expectedUpdatedAt: changed.updatedAt })
    expect(reverted.template).toBe(current.template)
    const after = await env.DB.prepare('SELECT theme, theme_accent AS accent, theme_font AS font, theme_radius AS radius, theme_width AS width, theme_mode AS mode FROM sites WHERE id = ?')
      .bind(siteId).first()
    expect(after).toEqual(before)
    expect(reverted.canRevert).toBe(false)
    const kept = await updateThemeOp(ctx, { expectedUpdatedAt: reverted.updatedAt, template: 'technical', keepLook: true })
    expect(kept.accent).toBe(current.accent)
    expect(kept.font).toBe(current.font)
  })

  it('counts tags in use and saves voice and signup settings with the key as actor', async () => {
    const t = Math.floor(Date.now() / 1000)
    for (const [id, tags, status] of [['one', '["AI","CMS"]', 'draft'], ['two', '["AI"]', 'published'], ['three', '["AI"]', 'archived']] as const) {
      await env.DB.prepare(`INSERT INTO posts (id, site_id, title, slug, content_markdown, status, created_by_type, created_by_id,
        updated_by_type, updated_by_id, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, '# Test', ?, 'api_key', ?, 'api_key', ?, ?, ?, ?)`)
        .bind(`manage-test-post-${id}`, siteId, id, `manage-${id}`, status, actor.id, actor.id, tags, t, t).run()
    }
    expect(await listTagsOp(ctx)).toEqual([{ name: 'AI', postCount: 2 }, { name: 'CMS', postCount: 1 }])
    const voiceRevision = (await getSiteOp(ctx))!.voiceProfile.revision
    const voice = await updateVoiceOp(ctx, { expectedUpdatedAt: voiceRevision, audience: 'Readers', tone: 'Plain language', doRules: ['Use examples'], dontRules: [], representativePostIds: [] })
    expect(voice).toMatchObject({ audience: 'Readers', voiceSummary: 'Plain language', updatedByName: 'Site Agent' })
    const signup = await updateSignupFormOp(ctx, { expectedUpdatedAt: (await getSiteSettings(owner)).updatedAt, description: 'One useful note each month' })
    expect(signup).toMatchObject({ description: 'One useful note each month', enabled: true })
    const rows = await env.DB.prepare("SELECT actor_name AS actorName FROM activity_events WHERE site_id = ? AND summary IN ('Updated the voice profile', 'Updated the signup form')")
      .bind(siteId).all<{ actorName: string }>()
    expect(rows.results.length).toBeGreaterThanOrEqual(2)
    expect(rows.results.every((row) => row.actorName === 'Site Agent')).toBe(true)
  })

  it('binds voice writes to the profile revision and exposes signup form state', async () => {
    const site = await getSiteOp(ctx)
    expect(site?.signupForm).toMatchObject({ enabled: true, heading: expect.any(String), description: expect.any(String), button: expect.any(String) })
    const revision = site!.voiceProfile.revision
    const write = { expectedUpdatedAt: revision, audience: 'Careful readers', tone: 'Direct',
      doRules: ['Use evidence'], dontRules: [], representativePostIds: [] }
    await updateVoiceOp(ctx, write)
    await expect(updateVoiceOp(ctx, { ...write, audience: 'Stale agent' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const after = await getSiteOp(ctx)
    expect(after?.voiceProfile.audience).toBe('Careful readers')
    expect(after!.voiceProfile.revision).toBeGreaterThan(revision)
    const event = await env.DB.prepare("SELECT summary, before_json AS beforeJson, after_json AS afterJson FROM activity_events WHERE site_id = ? AND action = 'site.voice.updated' AND after_json LIKE '%Careful readers%' LIMIT 1")
      .bind(siteId).first<{ summary: string; beforeJson: string; afterJson: string }>()
    expect(event?.summary).toBe('Updated the voice profile')
    expect(JSON.parse(event!.afterJson)).toMatchObject({ audience: 'Careful readers' })
  })

  it('redacts email and token shaped text in site activity details', async () => {
    const current = await getSiteOp(ctx)
    const secret = 'vc_abcdefghijklmnop'
    await updateSiteOp(ctx, { expectedUpdatedAt: current!.updatedAt,
      description: `Contact alice@example.com with ${secret}` })
    const row = await env.DB.prepare("SELECT after_json AS afterJson FROM activity_events WHERE site_id = ? AND summary = 'Updated site settings' AND after_json LIKE '%redacted%' ORDER BY created_at DESC LIMIT 1")
      .bind(siteId).first<{ afterJson: string }>()
    expect(row?.afterJson).toContain('[redacted email]')
    expect(row?.afterJson).toContain('[redacted secret]')
    expect(row?.afterJson).not.toContain('alice@example.com')
    expect(row?.afterJson).not.toContain(secret)
  })

  it('returns a clear paid-plan code on free sites and analytics data on entitled sites', async () => {
    await expect(getAnalyticsOp(ctx, { range: '7' })).rejects.toMatchObject({ code: 'ANALYTICS_PAID_PLAN', status: 402 })
    const paid = await getAnalyticsOp({ ...ctx, siteId: paidSiteId, workspaceId: paidWorkspaceId }, { range: '30' })
    expect(paid).toMatchObject({ status: 'unavailable', reason: 'not_configured' })
  })

  it('gives actionable recovery for past schedules and unavailable theme reverts', async () => {
    await expect(schedulePostOp(ctx, { postId: 'unused', versionNumber: 1, publishAt: 1 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('Confirm a new UTC time with the owner') })
    await expect(revertThemeOp(ctx, { expectedUpdatedAt: (await getSiteSettings(owner)).updatedAt + 1 }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('only retry when canRevert is true') })
  })
})

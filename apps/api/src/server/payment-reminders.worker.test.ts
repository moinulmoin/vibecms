/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { createDataAccess } from '@vc/db'
import { PAYMENT_REMINDERS_PER_RUN, runPaymentReminders } from './payment-reminders'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 10, 1, 9, 0, 0)

async function seedPastDue(suffix: string, pastDueSince = START): Promise<string> {
  const workspaceId = `reminder-ws-${suffix}`
  const ts = Math.floor(START / 1000) - 1000
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').bind(
      `reminder-owner-${suffix}`,
      `Owner ${suffix}`,
      `${suffix}@reminder.example.test`,
      ts,
      ts,
    ),
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(
      workspaceId,
      `Reminder ${suffix}`,
      `reminder-${suffix}`,
      ts,
      ts,
    ),
    env.DB.prepare("INSERT INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)").bind(
      `reminder-membership-${suffix}`,
      workspaceId,
      `reminder-owner-${suffix}`,
      ts,
      ts,
    ),
    env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(
      `reminder-site-${suffix}`,
      workspaceId,
      `Blog ${suffix}`,
      `reminder-site-${suffix}`,
      ts,
      ts,
    ),
    env.DB.prepare(
      "INSERT INTO billing_customers (id, workspace_id, status, past_due_since, created_at, updated_at) VALUES (?, ?, 'past_due', ?, ?, ?)",
    ).bind(`reminder-billing-${suffix}`, workspaceId, pastDueSince, ts, ts),
  ])
  return workspaceId
}

async function sentDays(workspaceId: string, pastDueSince = START) {
  const { results } = await env.DB.prepare(
    'SELECT day FROM billing_payment_reminders WHERE workspace_id = ? AND past_due_since = ? ORDER BY day',
  )
    .bind(workspaceId, pastDueSince)
    .all<{ day: number }>()
  return results.map((row) => row.day)
}

describe('failed-payment reminders', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, inject('migrations'))
  })

  it('emails on days 1, 3 and 6 of the grace, each exactly once', async () => {
    const workspaceId = await seedPastDue('schedule')

    await runPaymentReminders(env, START + 60_000)
    await runPaymentReminders(env, START + 60 * 60_000)
    expect(await sentDays(workspaceId)).toEqual([1])

    await runPaymentReminders(env, START + 1.5 * DAY_MS)
    expect(await sentDays(workspaceId)).toEqual([1])

    await runPaymentReminders(env, START + 2 * DAY_MS + 60_000)
    await runPaymentReminders(env, START + 2.5 * DAY_MS)
    expect(await sentDays(workspaceId)).toEqual([1, 3])

    await runPaymentReminders(env, START + 5 * DAY_MS + 60_000)
    await runPaymentReminders(env, START + 6.9 * DAY_MS)
    expect(await sentDays(workspaceId)).toEqual([1, 3, 6])
  })

  it('sends only the latest due email after missed runs, and nothing once the grace is over', async () => {
    const late = await seedPastDue('missed')
    const over = await seedPastDue('over')
    await env.DB.prepare('UPDATE billing_customers SET past_due_since = ? WHERE workspace_id = ?')
      .bind(START - 8 * DAY_MS, over)
      .run()

    const result = await runPaymentReminders(env, START + 5.5 * DAY_MS)

    expect(await sentDays(late)).toEqual([6])
    expect(await sentDays(over, START - 8 * DAY_MS)).toEqual([])
    expect(result.sent).toBeGreaterThanOrEqual(1)
  })

  it('stops as soon as the payment goes through, and starts over for a new failed renewal', async () => {
    const workspaceId = await seedPastDue('recovered')
    await runPaymentReminders(env, START + 60_000)
    await env.DB.prepare("UPDATE billing_customers SET status = 'active', past_due_since = NULL WHERE workspace_id = ?")
      .bind(workspaceId)
      .run()

    await runPaymentReminders(env, START + 2.5 * DAY_MS)
    expect(await sentDays(workspaceId)).toEqual([1])

    const next = START + 30 * DAY_MS
    await env.DB.prepare("UPDATE billing_customers SET status = 'past_due', past_due_since = ? WHERE workspace_id = ?")
      .bind(next, workspaceId)
      .run()
    await runPaymentReminders(env, next + 60_000)
    expect(await sentDays(workspaceId, next)).toEqual([1])
  })

  it('reaches a new failed renewal however many older episodes are already emailed', async () => {
    const older = START - DAY_MS
    const emailed: string[] = []
    for (let index = 0; index <= PAYMENT_REMINDERS_PER_RUN; index += 1) {
      emailed.push(await seedPastDue(`older-${index}`, older))
    }
    await runPaymentReminders(env, older + 60_000)
    await runPaymentReminders(env, older + 120_000)
    for (const workspaceId of emailed) expect(await sentDays(workspaceId, older)).toEqual([1])

    const fresh = await seedPastDue('fresh', START - 60_000)
    await runPaymentReminders(env, START)

    expect(await sentDays(fresh, START - 60_000)).toEqual([1])
  })

  it('hands off nothing once the payment went through after the episode was read', async () => {
    const workspaceId = await seedPastDue('raced')
    const billing = createDataAccess(env.DB).billing
    const graceMs = 7 * DAY_MS
    const [due] = (await billing.listDuePaymentReminders({ nowMs: START + 60_000, graceMs, days: [1, 3, 6], limit: 50 })).filter(
      (reminder) => reminder.workspaceId === workspaceId,
    )
    expect(due).toMatchObject({ day: 1, ownerEmail: 'raced@reminder.example.test', siteId: 'reminder-site-raced' })
    await env.DB.prepare("UPDATE billing_customers SET status = 'active', past_due_since = NULL WHERE workspace_id = ?")
      .bind(workspaceId)
      .run()

    const claim = { workspaceId, pastDueSince: START, day: 1, ownerEmail: due!.ownerEmail, nowMs: START + 60_000, graceMs, days: [1, 3, 6] }
    expect(await billing.claimPaymentReminder(claim)).toBe(false)
    expect(await sentDays(workspaceId)).toEqual([])
  })

  it('claims nothing read before the day moved on, the grace ended or the owner changed', async () => {
    const workspaceId = await seedPastDue('stale')
    const billing = createDataAccess(env.DB).billing
    const claim = {
      workspaceId,
      pastDueSince: START,
      day: 1,
      ownerEmail: 'stale@reminder.example.test',
      graceMs: 7 * DAY_MS,
      days: [1, 3, 6],
    }

    expect(await billing.claimPaymentReminder({ ...claim, nowMs: START + 2 * DAY_MS + 60_000 })).toBe(false)
    expect(await billing.claimPaymentReminder({ ...claim, day: 6, nowMs: START + 7 * DAY_MS })).toBe(false)
    expect(await billing.claimPaymentReminder({ ...claim, ownerEmail: 'former@reminder.example.test', nowMs: START + 60_000 })).toBe(false)
    expect(await sentDays(workspaceId)).toEqual([])

    expect(await billing.claimPaymentReminder({ ...claim, nowMs: START + 60_000 })).toBe(true)
  })

  it('never retries a failed send, so a rejecting recipient never holds back other blogs', async () => {
    const rejecting: string[] = []
    for (let index = 0; index < PAYMENT_REMINDERS_PER_RUN; index += 1) {
      rejecting.push(await seedPastDue(`rejecting-${index}`, START - 2 * DAY_MS))
    }
    const reached = await seedPastDue('reached', START - 60_000)
    const sentTo: { to: string; billingUrl: string }[] = []
    const send = async (email: { to: string; billingUrl: string }) => {
      if (email.to.startsWith('rejecting-')) throw new Error('E_RECIPIENT_SUPPRESSED')
      sentTo.push(email)
    }

    await runPaymentReminders(env, START, send)
    await runPaymentReminders(env, START + 60_000, send)

    for (const workspaceId of rejecting) expect(await sentDays(workspaceId, START - 2 * DAY_MS)).toEqual([3])
    expect(await sentDays(reached, START - 60_000)).toEqual([1])
    expect(sentTo.filter((email) => email.to === 'reached@reminder.example.test')).toEqual([
      expect.objectContaining({ billingUrl: expect.stringMatching(/\/dashboard\/billing\?site=reminder-site-reached$/) }),
    ])
  })

  it('never emails a blog AutoSEOPilot sponsors', async () => {
    const data = createDataAccess(env.DB)
    const ts = Math.floor(START / 1000) - 1000
    const sponsored = await data.managedSites.firstProvision({
      timestamp: ts,
      owner: { id: 'reminder-managed-owner', name: 'Managed Owner', email: 'managed@reminder.example.test' },
      workspace: { id: 'reminder-managed-ws', name: 'Managed', slug: 'reminder-managed' },
      membership: { id: 'reminder-managed-membership' },
      site: { id: 'reminder-managed-site', name: 'Managed Blog', slug: 'reminder-managed-site', description: null },
      defaultDomain: { id: 'reminder-managed-domain', hostname: 'reminder-managed.example.test' },
      apiKey: {
        id: 'reminder-managed-key',
        name: 'AutoSEOPilot',
        tokenPrefix: 'vc_test_reminder',
        tokenHash: 'hash-reminder-managed',
        scopesJson: '[]',
        actorName: 'AutoSEOPilot',
      },
      binding: {
        id: 'reminder-managed-binding',
        externalWorkspaceId: 'external-reminder-managed',
        credentialId: 'reminder-managed-credential',
        credentialGeneration: 1,
        entitlementStatus: 'active',
        entitlementExpiresAt: null,
        lifecycleRevision: 1,
      },
    })
    await env.DB.prepare(
      "INSERT INTO billing_customers (id, workspace_id, status, past_due_since, created_at, updated_at) VALUES (?, ?, 'past_due', ?, ?, ?)",
    )
      .bind('reminder-managed-billing', sponsored.workspaceId, START, ts, ts)
      .run()

    await runPaymentReminders(env, START + 60_000)

    expect(await sentDays(sponsored.workspaceId)).toEqual([])
  })
})

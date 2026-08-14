/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module 'vitest' {
  interface ProvidedContext {
    migrations: import('cloudflare:test').D1Migration[]
  }
}

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  createDataAccess,
  type ManagedFirstProvisionInput,
} from '@vc/db'
import {
  appSelectionCookie,
  readAppSelection,
} from './app-selection'
import {
  ensureOnboarding,
  resolveUserAppContext,
} from './onboarding'

const NOW = 1_900_000_000
const mutableEnv = env as unknown as Record<string, unknown>
const saved = {
  APP_ENV: mutableEnv.APP_ENV,
  BETTER_AUTH_SECRET: mutableEnv.BETTER_AUTH_SECRET,
}

function provisionInput(
  suffix: string,
  owner: { id: string; email: string },
): ManagedFirstProvisionInput {
  return {
    timestamp: NOW,
    owner: {
      id: owner.id,
      name: 'Managed owner',
      email: owner.email,
    },
    workspace: {
      id: `selection-workspace-${suffix}`,
      name: `Selection workspace ${suffix}`,
      slug: `selection-workspace-${suffix}`,
    },
    membership: { id: `selection-membership-${suffix}` },
    site: {
      id: `selection-site-${suffix}`,
      name: `Selection site ${suffix}`,
      slug: `selection-site-${suffix}`,
      description: null,
    },
    defaultDomain: {
      id: `selection-domain-${suffix}`,
      hostname: `selection-site-${suffix}.example.test`,
    },
    apiKey: {
      id: `selection-key-${suffix}`,
      name: 'Managed key',
      tokenPrefix: 'managed-selection',
      tokenHash: `selection-hash-${suffix}`,
      scopesJson: '[]',
      actorName: 'Managed agent',
    },
    binding: {
      id: `selection-binding-${suffix}`,
      externalWorkspaceId: `selection-external-${suffix}`,
      credentialId: `selection-credential-${suffix}`,
      credentialGeneration: 1,
      entitlementStatus: 'active',
      entitlementExpiresAt: null,
      lifecycleRevision: 1,
    },
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

afterEach(() => {
  mutableEnv.APP_ENV = saved.APP_ENV
  mutableEnv.BETTER_AUTH_SECRET = saved.BETTER_AUTH_SECRET
})

describe('same-email dashboard app selection', () => {
  it('reuses managed memberships without creating a derived personal workspace', async () => {
    const data = createDataAccess(env.DB)
    const owner = {
      id: 'selection-user-shared',
      email: 'selection-owner@example.test',
    }
    const first = provisionInput('first', owner)
    const second = provisionInput('second', {
      id: 'selection-user-second-request',
      email: ` ${owner.email.toUpperCase()} `,
    })
    await data.managedSites.firstProvision(first)
    await data.managedSites.firstProvision(second)
    const user = {
      id: owner.id,
      name: 'Managed owner',
      email: owner.email,
    }

    const initial = await resolveUserAppContext(user)
    expect(initial.apps).toHaveLength(2)
    expect(initial.app).toMatchObject({
      workspaceId: first.workspace.id,
      siteId: first.site.id,
    })

    const selected = await resolveUserAppContext(user, {
      workspaceId: second.workspace.id,
      siteId: second.site.id,
    })
    expect(selected.app).toMatchObject({
      workspaceId: second.workspace.id,
      siteId: second.site.id,
      actor: { role: 'owner' },
    })

    const otherOwner = {
      id: 'selection-user-other',
      email: 'selection-other@example.test',
    }
    const other = provisionInput('other-owner', otherOwner)
    await data.managedSites.firstProvision(other)
    const forged = await resolveUserAppContext(user, {
      workspaceId: other.workspace.id,
      siteId: other.site.id,
    })
    expect(forged.app).toMatchObject({
      workspaceId: first.workspace.id,
      siteId: first.site.id,
    })

    const stale = await resolveUserAppContext(user, {
      workspaceId: 'deleted-workspace',
      siteId: 'deleted-site',
    })
    expect(stale.app).toMatchObject({
      workspaceId: first.workspace.id,
      siteId: first.site.id,
    })

    await ensureOnboarding(user)
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM workspaces WHERE id = ?',
      )
        .bind(`workspace_${owner.id}`)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 })
  })

  it('prefers a managed app over an older unfinished personal workspace', async () => {
    const data = createDataAccess(env.DB)
    const user = {
      id: 'selection-user-with-personal',
      name: 'Selection owner',
      email: 'selection-owner-with-personal@example.test',
    }
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(user.id, user.name, user.email, NOW - 20, NOW - 20)
      .run()
    const personal = await ensureOnboarding(user)
    const managed = provisionInput('after-personal', user)
    await data.managedSites.firstProvision(managed)

    const resolved = await resolveUserAppContext(user)
    expect(resolved.app).toMatchObject({
      workspaceId: managed.workspace.id,
      siteId: managed.site.id,
    })
    expect(resolved.app.siteId).not.toBe(personal.siteId)
  })
})

describe('signed dashboard app selection cookie', () => {
  it('round-trips an authenticated selection and rejects tampering', async () => {
    mutableEnv.APP_ENV = 'test'
    mutableEnv.BETTER_AUTH_SECRET = 'selection-cookie-secret-placeholder'
    const selection = {
      workspaceId: 'selection-workspace-cookie',
      siteId: 'selection-site-cookie',
    }
    const setCookie = await appSelectionCookie(selection)
    const cookie = setCookie.split(';', 1)[0]!

    expect(
      await readAppSelection(
        new Request('https://app.example.test/api/dashboard/context', {
          headers: { cookie },
        }),
      ),
    ).toEqual(selection)

    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`
    expect(
      await readAppSelection(
        new Request('https://app.example.test/api/dashboard/context', {
          headers: { cookie: tampered },
        }),
      ),
    ).toBeNull()
  })
})

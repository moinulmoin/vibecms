import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainRecord, DomainRepository } from '@vc/core'

const createCustomHostname = vi.fn()

vi.mock('./custom-hostnames', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./custom-hostnames')>()
  return {
    ...actual,
    createCustomHostname: (...args: unknown[]) => createCustomHostname(...args),
  }
})

import {
  CUSTOM_HOSTNAME_PROVISIONING_ERROR,
  ensureCustomHostnameProvisioned,
} from './custom-domains'

describe('custom hostname provisioning retry state', () => {
  function memoryRepo(seed: DomainRecord): DomainRepository & { row: DomainRecord } {
    const state = { row: { ...seed } }
    return {
      get row() {
        return state.row
      },
      async listBySite() {
        return [state.row]
      },
      async getByHostname(hostname) {
        return state.row.hostname === hostname ? state.row : null
      },
      async insert() {},
      async reclaimStale() {
        return 0
      },
      async deleteCustomForSite() {
        return 0
      },
      async setProvisioning(id, siteId, patch) {
        expect(id).toBe(state.row.id)
        expect(siteId).toBe(state.row.siteId)
        state.row = {
          ...state.row,
          cloudflareCustomHostnameId: patch.cloudflareCustomHostnameId,
          status: patch.status,
          verificationErrorsJson: patch.verificationErrorsJson,
          updatedAt: state.row.updatedAt + 1,
        }
      },
    }
  }

  const baseRecord = (): DomainRecord => ({
    id: 'dom-retry',
    siteId: 'site-retry',
    hostname: 'retry.example.test',
    type: 'custom',
    status: 'pending',
    cloudflareCustomHostnameId: null,
    verificationErrorsJson: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  })

  beforeEach(() => {
    createCustomHostname.mockReset()
  })

  it('marks a transient create failure as failed with an actionable retry error (not pending success)', async () => {
    createCustomHostname.mockResolvedValue(null)
    const repo = memoryRepo(baseRecord())

    const result = await ensureCustomHostnameProvisioned(repo, 'site-retry', repo.row)

    expect(result.ok).toBe(false)
    expect(result.domain.status).toBe('failed')
    expect(result.domain.verificationErrors).toEqual([CUSTOM_HOSTNAME_PROVISIONING_ERROR])
    expect(repo.row.cloudflareCustomHostnameId).toBeNull()
    expect(repo.row.status).toBe('failed')
    expect(repo.row.verificationErrorsJson).toBe(JSON.stringify([CUSTOM_HOSTNAME_PROVISIONING_ERROR]))
  })

  it('retries provisioning for a failed row with no provider id and persists the Cloudflare id', async () => {
    createCustomHostname.mockResolvedValue({
      id: 'cf-host-1',
      hostname: 'retry.example.test',
      status: 'pending',
      ssl: { status: 'pending_validation' },
    })
    const repo = memoryRepo({
      ...baseRecord(),
      status: 'failed',
      verificationErrorsJson: JSON.stringify([CUSTOM_HOSTNAME_PROVISIONING_ERROR]),
    })

    const result = await ensureCustomHostnameProvisioned(repo, 'site-retry', repo.row)

    expect(result.ok).toBe(true)
    expect(result.domain.status).toBe('pending')
    expect(result.domain.verificationErrors).toEqual([])
    expect(repo.row.cloudflareCustomHostnameId).toBe('cf-host-1')
    expect(repo.row.status).toBe('pending')
  })
})

import { createDataAccess } from '@vc/db'
import { voiceProfileSettingsInputSchema, type VoiceProfileSettingsInput } from '@vc/validators'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from './onboarding'

export type VoiceProfileMutationResult =
  | { kind: 'ok'; code: 'voice_profile_saved' | 'voice_profile_cleared' }
  | { kind: 'error'; code: 'voice_profile_invalid' }
function editorFor(app: AppUserContext) {
  if (app.actor.type !== 'human') throw new Error('Human access required')
  return { type: 'human' as const, id: app.actor.id, name: app.actor.name }
}

export async function getVoiceProfileForSite(siteId: string) {
  return createDataAccess(env.DB).voiceProfiles.getBySite(siteId)
}

export type VoiceProfileSettings = {
  configured: boolean
  audience: string
  voiceSummary: string
  preferRules: string[]
  avoidRules: string[]
  representativePostIds: string[]
  warnings: string[]
  updatedByName: string | null
  updatedAt: number | null
  publishedPosts: Array<{ id: string; title: string; slug: string; updatedAt: number }>
}

export async function getVoiceProfileSettings(app: AppUserContext): Promise<VoiceProfileSettings> {
  const db = createDataAccess(env.DB)
  const [profile, publishedPosts] = await Promise.all([
    db.voiceProfiles.getBySite(app.siteId),
    db.posts.listPosts({ siteId: app.siteId, status: 'published', limit: 100, offset: 0 }),
  ])
  return {
    configured: profile ? true : false,
    audience: profile?.audience ?? '',
    voiceSummary: profile?.voiceSummary ?? '',
    preferRules: profile?.guidelines.filter((rule) => rule.kind === 'prefer').map((rule) => rule.text) ?? [],
    avoidRules: profile?.guidelines.filter((rule) => rule.kind === 'avoid').map((rule) => rule.text) ?? [],
    representativePostIds: profile?.representativePostIds ?? [],
    warnings: profile?.warnings ?? [],
    updatedByName: profile?.updatedBy.name ?? null,
    updatedAt: profile?.updatedAt ?? null,
    publishedPosts: publishedPosts.map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      updatedAt: post.updatedAt,
    })),
  }
}

export async function updateVoiceProfileForApp(
  app: AppUserContext,
  rawPayload: VoiceProfileSettingsInput,
): Promise<VoiceProfileMutationResult> {
  const parsed = voiceProfileSettingsInputSchema.safeParse(rawPayload)
  if (!parsed.success) return { kind: 'error', code: 'voice_profile_invalid' }

  const payload = parsed.data
  const audience = payload.audience?.trim() || null
  const voiceSummary = payload.voiceSummary?.trim() || null
  const guidelines = [
    ...payload.preferRules.map((text) => ({ kind: 'prefer' as const, text, source: { kind: 'explicit' as const } })),
    ...payload.avoidRules.map((text) => ({ kind: 'avoid' as const, text, source: { kind: 'explicit' as const } })),
  ]

  try {
    await createDataAccess(env.DB).voiceProfiles.save({
      siteId: app.siteId,
      audience,
      voiceSummary,
      guidelines,
      representativePostIds: payload.representativePostIds,
      editor: editorFor(app),
      timestamp: Math.floor(Date.now() / 1000),
      activityId: crypto.randomUUID(),
    })
    return { kind: 'ok', code: 'voice_profile_saved' }
  } catch (error) {
    throw error
  }
}

export async function clearVoiceProfileForApp(app: AppUserContext): Promise<VoiceProfileMutationResult> {
  await createDataAccess(env.DB).voiceProfiles.clear({
    siteId: app.siteId,
    editor: editorFor(app),
    timestamp: Math.floor(Date.now() / 1000),
    activityId: crypto.randomUUID(),
  })
  return { kind: 'ok', code: 'voice_profile_cleared' }
}

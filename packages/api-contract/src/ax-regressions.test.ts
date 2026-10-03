import { normalizeThemeChoice, updateThemeRequestSchema } from './requests'
import { describe, expect, it } from 'vitest'
import {
  archivePostRequestSchema, createPostRequestSchema, operationsByToolName, previewPostRequestSchema,
  schedulePostRequestSchema, siteDtoSchema, siteWithSignupFormDtoSchema, themeDtoSchema, updateVoiceRequestSchema,
  zodToInputJsonSchema, zodToJsonSchema,
} from './index'

const approval = 'Live change: needs explicit owner approval first (see server instructions).'

describe('agent operation contract', () => {
  it('requires voice revision, defines the unconfigured revision, and permits a version bound archive', () => {
    expect(updateVoiceRequestSchema.safeParse({ audience: 'A', tone: 'B', doRules: [], dontRules: [], representativePostIds: [] }).success).toBe(false)
    expect(updateVoiceRequestSchema.safeParse({ expectedUpdatedAt: 0, audience: 'A', tone: 'B', doRules: [], dontRules: [], representativePostIds: [] }).success).toBe(true)
    expect(archivePostRequestSchema.parse({ postId: 'p', expectedVersionNumber: 2 })).toEqual({ postId: 'p', expectedVersionNumber: 2 })
    expect(archivePostRequestSchema.parse({ postId: 'p' })).toEqual({ postId: 'p' })
    expect(siteDtoSchema.shape.voiceProfile.shape.revision.parse(0)).toBe(0)
    expect(zodToJsonSchema(siteWithSignupFormDtoSchema).required).toContain('signupForm')
    expect((zodToInputJsonSchema(createPostRequestSchema) as any).properties.slug.description).toContain('dashboard')
  })

  it('accepts Unix seconds or offset-aware ISO time and rejects naive time', () => {
    const base = { postId: 'p', versionNumber: 1 }
    expect(schedulePostRequestSchema.parse({ ...base, publishAt: 1_800_000_000 }).publishAt).toBe(1_800_000_000)
    expect(schedulePostRequestSchema.parse({ ...base, publishAt: '2027-01-01T09:00:00Z' }).publishAt).toBe(1_798_794_000)
    expect(schedulePostRequestSchema.parse({ ...base, publishAt: '2027-01-01T11:00:00+02:00' }).publishAt).toBe(1_798_794_000)
    expect(schedulePostRequestSchema.safeParse({ ...base, publishAt: '2027-01-01T09:00:00' }).success).toBe(false)
  })

  it('encodes exclusive preview modes in the tool schema and parser', () => {
    const schema = zodToInputJsonSchema(previewPostRequestSchema)
    expect(schema.anyOf ?? schema.oneOf).toHaveLength(2)
    expect(previewPostRequestSchema.safeParse({ postId: 'p' }).success).toBe(true)
    expect(previewPostRequestSchema.safeParse({ contentMarkdown: '' }).success).toBe(true)
    expect(previewPostRequestSchema.safeParse({ postId: 'p', contentMarkdown: '' }).success).toBe(false)
    expect(previewPostRequestSchema.safeParse({}).success).toBe(false)
  })

  it('preserves reused output objects and discriminated voice sources', () => {
    const theme = zodToJsonSchema(themeDtoSchema) as any
    expect(theme.properties.options.properties.accents.items).toHaveProperty('$ref')
    expect(theme.$defs.__schema0.properties.id.type).toBe('string')
    const site = zodToJsonSchema(siteDtoSchema) as any
    expect(site.properties.navLinks.items).toHaveProperty('$ref')
    expect(site.$defs.__schema0.properties.label.type).toBe('string')
    expect(site.properties.voiceProfile.properties.guidelines.items.properties.source.oneOf).toHaveLength(2)
  })

  it('uses one approval rule and precise operation guidance', () => {
    const live = ['posts.publish', 'posts.schedule', 'posts.archive', 'sites.update', 'sites.theme.update', 'sites.theme.revert', 'sites.voice.update', 'sites.signup_form.update', 'assets.delete'] as const
    for (const name of live) expect(operationsByToolName[name].description).toContain(approval)
    expect(operationsByToolName['posts.archive'].description).toContain('expectedVersionNumber')
    expect(operationsByToolName['posts.publish'].description).toContain('posts.get.currentVersionNumber')
    expect(operationsByToolName['sites.signup_form.update'].description).toContain('expectedUpdatedAt')
    expect(operationsByToolName['sites.theme.revert'].description).toContain('canRevert')
    expect(operationsByToolName['posts.create'].description).toContain('previewUrl')
    expect(operationsByToolName['posts.preview'].description).toContain('secret bearer link')
    expect(operationsByToolName['assets.upload'].description).toContain('public before post publication')
    expect(operationsByToolName['posts.list'].description).not.toContain('Returns NOT_FOUND')
  })

  it('accepts the template and font names an owner actually says', () => {
    const parsed = updateThemeRequestSchema.parse({ expectedUpdatedAt: 1, template: 'Magazine', font: 'newsreader' })
    expect(normalizeThemeChoice('template', parsed.template)).toBe('product')
    expect(normalizeThemeChoice('template', 'notebook')).toBe('technical')
    expect(normalizeThemeChoice('template', 'editorial')).toBe('editorial')
    expect(normalizeThemeChoice('font', parsed.font)).not.toBe('newsreader')
    expect(() => updateThemeRequestSchema.parse({ expectedUpdatedAt: 1, template: 'brutalist' })).toThrow()
  })
})

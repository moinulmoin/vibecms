// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, markdownAdapterResult, normalizeMarkdown, visualMarkdownSafety } from './md-adapter'

describe('markdown adapter', () => {
  it('round-trips callouts and toc markers as custom blocks', () => {
    const source = '> [!TIP]\n> Keep the source canonical.\n> \n> It is safe.\n\n[[toc]]\n\nBody.\n'
    const result = markdownAdapterResult(source)
    expect(result.blocks.some((block) => block.type === 'vcCallout')).toBe(true)
    expect(result.blocks.some((block) => block.type === 'vcToc')).toBe(true)
    expect(normalizeMarkdown(result.roundTripMarkdown)).toBe(normalizeMarkdown(source))
    expect(result.drifted).toBe(false)
  })

  it('round-trips more than ten callouts without leaking internal markers', () => {
    const source = `${Array.from({ length: 12 }, (_, index) => `> [!TIP]\n> Callout ${index + 1}.`).join('\n\n')}\n`
    const result = visualMarkdownSafety(source)
    expect(result.safe).toBe(true)
    expect(result.roundTripMarkdown).toBe(source)
    expect(result.roundTripMarkdown).not.toContain('vc-callout-marker-')
  })

  it('keeps tasks, tables, and tight lists in the whole-document export', () => {
    const source = '- [x] Done\n- [ ] Next\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n- one\n- two'
    const result = markdownAdapterResult(source)
    const output = blocksToMarkdown(result.blocks)
    expect(output).toContain('- [x] Done')
    expect(output).toContain('| Name | Value |')
    expect(output).toContain('- one\n- two')
  })

  it('marks unsupported syntax as drift instead of silently claiming fidelity', () => {
    const result = visualMarkdownSafety('::: custom-directive\nunsupported\n:::')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('unsupported_syntax')
  })

  it('requires literal byte fidelity instead of normalizing whitespace', () => {
    const result = visualMarkdownSafety('Body with trailing spaces.  \n')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('lossy_round_trip')
  })

  it('rejects source text that collides with private adapter markers', () => {
    const result = visualMarkdownSafety('vc-callout-marker-1\uE001')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('internal_marker')
  })
})

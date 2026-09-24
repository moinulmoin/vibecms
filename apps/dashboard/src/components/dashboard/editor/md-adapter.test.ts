// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, createMarkdownEditor, markdownAdapterResult, markdownOutsideCode, normalizeMarkdown, visualMarkdownSafety } from './md-adapter'

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

  it('keeps meaningful whitespace: a two-space hard break is not normalized away', () => {
    const result = visualMarkdownSafety('Line one  \nline two\n')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('lossy_round_trip')
  })

  it('ignores meaningless trailing spaces at the end of a block', () => {
    expect(visualMarkdownSafety('Body with trailing spaces.  \n').safe).toBe(true)
  })

  it('rejects source text that collides with private adapter markers', () => {
    const result = visualMarkdownSafety('vc-callout-marker-1\uE001')
    expect(result.safe).toBe(false)
    expect(result.reason).toBe('internal_marker')
  })
})

describe('visual safety ignores code', () => {
  it('allows braces and HTML inside fenced code and inline code', () => {
    const source = 'Use `{name}` and `<div>` here.\n\n```ts\nconst a = { b: 1 }\nconst el = <div />\n```\n'
    expect(markdownOutsideCode(source)).not.toMatch(/[{<]/)
    const result = visualMarkdownSafety(source)
    expect(result.reason).not.toBe('unsupported_syntax')
  })

  it('still flags HTML in prose', () => {
    expect(visualMarkdownSafety('Hello <span>there</span>\n').reason).toBe('unsupported_syntax')
  })
})

describe('media urls', () => {
  it('keeps uploaded /media-assets images relative so image posts stay visually editable', () => {
    const source = 'Intro.\n\n![A red bike](/media-assets/abc123)\n\nOutro.\n'
    const result = visualMarkdownSafety(source)
    expect(result.roundTripMarkdown).toBe(source)
    expect(result.safe).toBe(true)
  })

  it('does not rewrite an absolute same-origin image the author wrote', () => {
    const source = `![A](${window.location.origin}/media-assets/abc)\n`
    expect(visualMarkdownSafety(source).roundTripMarkdown).toBe(source)
  })
})

describe('visual edits stay visual', () => {
  function exportState(blocks: unknown[]) {
    const editor = createMarkdownEditor()
    editor.replaceBlocks(editor.document, blocks as never)
    const markdown = blocksToMarkdown(editor.document as never, editor)
    return { markdown, safety: visualMarkdownSafety(markdown, editor) }
  }

  it('an empty paragraph mid-document (Enter between paragraphs) is not lossy', () => {
    const { markdown, safety } = exportState([
      { type: 'paragraph', content: 'First.' },
      { type: 'paragraph', content: '' },
      { type: 'paragraph', content: 'Second.' },
    ])
    expect(markdown).toBe('First.\n\nSecond.\n')
    expect(safety.safe).toBe(true)
  })

  it('keeps blank lines inside code blocks', () => {
    const { markdown } = exportState([{ type: 'codeBlock', props: { language: 'ts' }, content: 'a\n\n\nb' }])
    expect(markdown).toBe('```ts\na\n\n\nb\n```\n')
  })

  it('keeps links and formatting added inside a callout', () => {
    const { markdown, safety } = exportState([{
      type: 'vcCallout',
      props: { kind: 'NOTE' },
      content: [
        { type: 'text', text: 'Read ', styles: {} },
        { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'the docs', styles: {} }] },
        { type: 'text', text: ' now', styles: { bold: true } },
      ],
    }])
    expect(markdown).toBe('> [!NOTE]\n> Read [the docs](https://example.com) **now**\n')
    expect(safety.roundTripMarkdown).toBe(markdown)
  })
})

describe('trailing whitespace never ejects the writer from Visual mode', () => {
  it('treats a heading or paragraph with a trailing space as round-trippable', () => {
    const editor = createMarkdownEditor()
    for (const md of ['## A section heading \n\nPara.\n', 'Hello \n\nWorld\n', '- item \n']) {
      expect(visualMarkdownSafety(md, editor).safe).toBe(true)
    }
  })

  it('keeps trailing spaces inside fenced code significant', () => {
    const editor = createMarkdownEditor()
    const md = '```ts\nconst a = 1;  \n```\n'
    const result = visualMarkdownSafety(md, editor)
    expect(result.roundTripMarkdown.includes('const a = 1;  ') || !result.safe).toBe(true)
  })
})

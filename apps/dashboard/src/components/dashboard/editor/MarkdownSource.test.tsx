// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { MarkdownSource, applySlashCommand, filterSlashCommands, slashQueryAt } from './MarkdownSource'

describe('MarkdownSource', () => {
  it('preserves the slash command workflow from the source editor', () => {
    expect(slashQueryAt('Intro\n/he', 9)).toEqual({ start: 6, query: 'he' })
    const command = filterSlashCommands('h2')[0]
    expect(applySlashCommand('Intro\n/he', 9, 6, command).value).toContain('## Heading')
  })

  it('emits exact user transactions without echoing controlled prop updates', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const changes: string[] = []
    act(() => root.render(<MarkdownSource value="seed" onChange={(value) => changes.push(value)} />))
    const host = container.querySelector('[data-testid="markdown-source-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)
    expect(view).toBeTruthy()
    act(() => {
      view?.dispatch({ changes: { from: 0, to: 4, insert: 'edited  \n' }, userEvent: 'input.type' })
    })
    expect(changes).toEqual(['edited  \n'])
    act(() => root.render(<MarkdownSource value="server value" onChange={(value) => changes.push(value)} />))
    expect(view?.state.doc.toString()).toBe('server value')
    expect(changes).toEqual(['edited  \n'])
    act(() => root.unmount())
    container.remove()
  })
})

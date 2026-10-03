// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { MarkdownSource, applySlashCommand, filterSlashCommands, slashQueryAt, toggleInlineMarker } from './MarkdownSource'

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

  it('opens the image picker from /image and wraps bold with Mod-B', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<MarkdownSource value="" onChange={() => {}} uploadFile={async () => '/media-assets/x'} />))
    const host = container.querySelector('[data-testid="markdown-source-editor"]') as HTMLElement
    const view = EditorView.findFromDOM(host)!
    const input = container.querySelector('[data-testid="markdown-image-input"]') as HTMLInputElement
    let clicked = 0
    input.click = () => { clicked += 1 }
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '/image' }, selection: { anchor: 6 }, userEvent: 'input.type' })
    })
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(clicked).toBe(1)

    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'bold' }, selection: { anchor: 0, head: 4 } })
      toggleInlineMarker(view, '**')
    })
    expect(view.state.doc.toString()).toBe('**bold**')
    act(() => toggleInlineMarker(view, '**'))
    expect(view.state.doc.toString()).toBe('bold')
    act(() => root.unmount())
    container.remove()
  })
})

// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'

vi.mock('~/lib/api-client', () => ({
  loadPostsPage: vi.fn(async () => ({ posts: [{ tags: ['django'] }, { tags: ['golang'] }] })),
}))

import { PostMetadataRail, type EditorMetadata } from './PostMetadataRail'

const metadata: EditorMetadata = {
  title: 'T', slug: 't', tags: '', excerpt: '', coverAssetId: '', layout: 'standard', toc: false, seoTitle: '', seoDescription: '', canonicalUrl: '',
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function renderRail(onChange: (field: keyof EditorMetadata, value: string | boolean) => void) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(withQueryClient(<PostMetadataRail metadata={metadata} assets={[]} supportedLayouts={['standard']} supportsToc={false} onChange={onChange} />))
  })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host.querySelector<HTMLInputElement>('input[aria-label="Add tag"]')!
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    input.focus()
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(input: HTMLInputElement, name: string) {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
}

describe('TagInput', () => {
  it('commits exactly what was typed even when a longer existing tag contains it', async () => {
    const onChange = vi.fn()
    const input = await renderRail(onChange)
    type(input, 'go')
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain('golang')
    key(input, 'Enter')
    expect(onChange).toHaveBeenCalledWith('tags', 'go')
  })

  it('uses a suggestion once the writer arrows into it', async () => {
    const onChange = vi.fn()
    const input = await renderRail(onChange)
    type(input, 'go')
    key(input, 'ArrowDown')
    key(input, 'Enter')
    expect(onChange).toHaveBeenCalledWith('tags', expect.stringMatching(/^(golang|django)$/))
  })
})

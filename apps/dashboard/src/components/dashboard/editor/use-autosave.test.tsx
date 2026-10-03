// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutosave } from './use-autosave'

function Harness({ value, save, onStatus, onError, onAutosave }: {
  value: string
  save: (value: string) => Promise<{ versionNumber: number }>
  onStatus: (status: string) => void
  onError?: (error: unknown, value: string) => void
  onAutosave?: (autosave: ReturnType<typeof useAutosave>) => void
}) {
  const autosave = useAutosave({ serialized: value, save, onError })
  onAutosave?.(autosave)
  onStatus(autosave.status)
  return null
}

describe('useAutosave', () => {
  afterEach(() => vi.useRealTimers())

  it('saves only after idle and only when the serialized value changes', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const root = createRoot(container)
    const save = vi.fn(async () => ({ versionNumber: 2 }))
    const statuses: string[] = []
    act(() => root.render(<Harness value="one" save={save} onStatus={(status) => statuses.push(status)} />))
    act(() => root.render(<Harness value="two" save={save} onStatus={(status) => statuses.push(status)} />))
    act(() => vi.advanceTimersByTime(2499))
    expect(save).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('two')
    act(() => root.render(<Harness value="two" save={save} onStatus={(status) => statuses.push(status)} />))
    act(() => vi.advanceTimersByTime(3000))
    expect(save).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('saved')
    act(() => root.unmount())
    container.remove()
  })

  it('keeps newer edits unsaved when an explicit save marks an older snapshot as saved', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const save = vi.fn(async () => ({ versionNumber: 2 }))
    const statuses: string[] = []
    let autosave: ReturnType<typeof useAutosave> | undefined

    act(() => root.render(
      <Harness
        value="submitted"
        save={save}
        onStatus={(status) => statuses.push(status)}
        onAutosave={(value) => { autosave = value }}
      />,
    ))
    act(() => root.render(
      <Harness
        value="typed while saving"
        save={save}
        onStatus={(status) => statuses.push(status)}
        onAutosave={(value) => { autosave = value }}
      />,
    ))
    act(() => autosave?.markSaved('submitted', 2))

    expect(statuses.at(-1)).toBe('unsaved')
    expect(autosave?.savedVersion).toBe(2)
    act(() => root.unmount())
    container.remove()
  })

  it('reports the exact rejected snapshot so a version conflict can preserve it', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const root = createRoot(container)
    const conflict = new Error('version conflict')
    const save = vi.fn(async () => { throw conflict })
    const onError = vi.fn()
    const statuses: string[] = []

    act(() => root.render(<Harness value="v1" save={save} onError={onError} onStatus={(status) => statuses.push(status)} />))
    act(() => root.render(<Harness value="local exact bytes" save={save} onError={onError} onStatus={(status) => statuses.push(status)} />))
    await act(async () => vi.advanceTimersByTime(2500))

    expect(onError).toHaveBeenCalledWith(conflict, 'local exact bytes')
    expect(statuses).toContain('error')
    act(() => root.unmount())
    container.remove()
  })
})

describe('useAutosave flush', () => {
  it('waits for the in-flight save and then saves the newest edits immediately', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    let release: (() => void) | undefined
    const save = vi.fn((value: string) => value === 'two'
      ? new Promise<{ versionNumber: number }>((resolve) => { release = () => resolve({ versionNumber: 2 }) })
      : Promise.resolve({ versionNumber: 3 }))
    let autosave: ReturnType<typeof useAutosave> | undefined
    const render = (value: string) => act(() => root.render(
      <Harness value={value} save={save} onStatus={() => {}} onAutosave={(next) => { autosave = next }} />,
    ))
    render('one')
    render('two')
    let flushed: Promise<boolean> | undefined
    await act(async () => { flushed = autosave?.flush() })
    render('three')
    await act(async () => {
      const second = autosave?.flush()
      release?.()
      await flushed
      expect(await second).toBe(true)
    })
    expect(save.mock.calls.map(([value]) => value)).toEqual(['two', 'three'])
    act(() => root.unmount())
    container.remove()
  })
})

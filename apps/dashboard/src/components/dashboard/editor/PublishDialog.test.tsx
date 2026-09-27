// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { PublishDialog } from './PublishDialog'

describe('PublishDialog scheduling', () => {
  it('shows the viewer timezone and submits a local selection as UTC epoch seconds', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSchedule = vi.fn()
    await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} versionNumber={3}
      liveVersionNumber={null} liveUrl={null} warnings={[]} pending={false} error={null}
      onConfirm={() => {}} onSchedule={onSchedule} />))
    const scheduleMode = document.querySelector<HTMLInputElement>('input[type="radio"][value="schedule"]')
      ?? [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].at(-1)
    await act(async () => scheduleMode?.click())
    expect(document.body.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const time = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    const local = new Date(Date.now() + 86_400_000)
    const value = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(time, value)
      time.dispatchEvent(new Event('input', { bubbles: true }))
      time.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const submit = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Schedule v3'))
    await act(async () => submit?.click())
    expect(onSchedule).toHaveBeenCalledWith(Math.floor(new Date(value).getTime() / 1000))
    await act(async () => root.unmount())
    host.remove()
  })
})

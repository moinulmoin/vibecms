// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { PublishDialog, quickPicks, timezoneLabel } from './PublishDialog'

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const pad = (n: number) => String(n).padStart(2, '0')

async function renderDialog(onSchedule = vi.fn(), onConfirm = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} versionNumber={3}
    liveVersionNumber={null} liveUrl={null} warnings={[]} pending={false} error={null}
    onConfirm={onConfirm} onSchedule={onSchedule} />))
  return { onSchedule, onConfirm, cleanup: async () => { await act(async () => root.unmount()); host.remove() } }
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

describe('PublishDialog', () => {
  it('publishes now by default', async () => {
    const view = await renderDialog()
    await act(async () => button('Publish v3 now')?.click())
    expect(view.onConfirm).toHaveBeenCalled()
    await view.cleanup()
  })

  it('schedules a local date and time as UTC epoch seconds and says when in plain words', async () => {
    const view = await renderDialog()
    await act(async () => document.querySelector<HTMLButtonElement>('button[role="radio"][value="schedule"]')?.click())
    expect(document.body.textContent).toContain(timezoneLabel())
    const local = new Date(Date.now() + 2 * 86_400_000)
    local.setHours(14, 30, 0, 0)
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[type="date"]')!, `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`)
      setValue(document.querySelector<HTMLInputElement>('input[type="time"]')!, '14:30')
    })
    expect(document.body.textContent).toContain('Goes live')
    await act(async () => button('Schedule v3')?.click())
    expect(view.onSchedule).toHaveBeenCalledWith(Math.floor(local.getTime() / 1000))
    await view.cleanup()
  })

  it('offers quick picks in the future and names the timezone like a person would', () => {
    const now = new Date(2026, 9, 1, 15, 7)
    const picks = quickPicks(now)
    expect(picks.map((p) => p.label)).toEqual(['In an hour', 'Tomorrow, 9:00', 'Monday, 9:00'])
    for (const pick of picks) expect(pick.at.getTime()).toBeGreaterThan(now.getTime())
    expect(picks[0]!.at.getMinutes() % 15).toBe(0)
    expect(picks[2]!.at.getDay()).toBe(1)
    expect(timezoneLabel('Asia/Nicosia')).toBe('Nicosia time')
    expect(timezoneLabel('America/New_York')).toBe('New York time')
  })
})

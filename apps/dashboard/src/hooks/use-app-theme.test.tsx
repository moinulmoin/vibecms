// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { applyAppTheme, readAppTheme, useAppTheme } from './use-app-theme'

function ThemeProbe() {
  const { theme, setTheme } = useAppTheme()
  return (
    <button type="button" onClick={() => setTheme('light')}>
      {theme}
    </button>
  )
}

describe('app theme', () => {
  let container: HTMLDivElement
  let unmount: (() => void) | undefined

  beforeEach(() => {
    unmount = undefined
    localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => unmount?.())
    container.remove()
  })

  it('defaults to dark when no preference is stored', () => {
    expect(readAppTheme()).toBe('dark')
    applyAppTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('persists changes and applies them immediately', () => {
    act(() => {
      const root = createRoot(container)
      unmount = () => root.unmount()
      root.render(<ThemeProbe />)
    })

    const button = container.querySelector('button')
    expect(button?.textContent).toBe('dark')

    act(() => button?.click())

    expect(button?.textContent).toBe('light')
    expect(localStorage.getItem('vc-theme')).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

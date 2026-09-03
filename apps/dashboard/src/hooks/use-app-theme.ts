import { useCallback, useEffect, useState } from 'react'

export const APP_THEME_STORAGE_KEY = 'vc-theme'
export const APP_THEMES = ['light', 'dark', 'system'] as const

export type AppTheme = (typeof APP_THEMES)[number]
export type ResolvedAppTheme = Exclude<AppTheme, 'system'>

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'light' || value === 'dark' || value === 'system'
}

function systemTheme(): ResolvedAppTheme {
  return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveAppTheme(theme: AppTheme): ResolvedAppTheme {
  return theme === 'system' ? systemTheme() : theme
}

export function readAppTheme(): AppTheme {
  if (typeof window === 'undefined') return 'dark'

  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    return isAppTheme(stored) ? stored : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return

  const resolved = resolveAppTheme(theme)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

export function useAppTheme() {
  const [theme, setThemeState] = useState<AppTheme>(readAppTheme)

  useEffect(() => {
    applyAppTheme(theme)

    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyAppTheme('system')
    const supportsEventListener = typeof media.addEventListener === 'function'

    if (supportsEventListener) {
      media.addEventListener('change', handleChange)
    } else {
      media.addListener(handleChange)
    }

    return () => {
      if (supportsEventListener) {
        media.removeEventListener('change', handleChange)
      } else {
        media.removeListener(handleChange)
      }
    }
  }, [theme])

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(nextTheme)
    applyAppTheme(nextTheme)

    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
    }
  }, [])

  return { theme, setTheme }
}

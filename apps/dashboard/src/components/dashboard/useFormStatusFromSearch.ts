import { FORM_STATUS, readFormStatus, type FormStatus } from '@vc/config'
import { useSearch } from '@tanstack/react-router'

const EXTRA_OK: Record<string, FormStatus> = {
  site_saved: {
    variant: 'success',
    title: 'Settings saved',
    message: 'Your site details and SEO defaults are updated.',
  },
  post_restored: {
    variant: 'success',
    title: 'Version restored',
    message: 'The post has been rolled back to the selected version.',
  },
}

/** Maps allowlisted `?ok=` / `?error=` search params to {@link StatusAlert} input. */
export function resolveFormStatus(search: { ok?: string; error?: string }): FormStatus | null {
  const params = new URLSearchParams()
  if (search.error) params.set('error', search.error)
  else if (search.ok) params.set('ok', search.ok)
  const fromConfig = readFormStatus(params)
  if (fromConfig) return fromConfig
  if (search.ok && EXTRA_OK[search.ok]) return EXTRA_OK[search.ok]
  if (search.error) return FORM_STATUS[search.error] ?? FORM_STATUS.unknown
  return null
}

export function useFormStatusFromSearch(): FormStatus | null {
  const search = useSearch({ strict: false }) as { ok?: string; error?: string }
  return resolveFormStatus(search)
}
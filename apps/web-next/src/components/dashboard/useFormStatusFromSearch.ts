import { readFormStatus, type FormStatus } from '@vc/config'
import { useSearch } from '@tanstack/react-router'

/** Maps allowlisted `?ok=` / `?error=` search params to {@link StatusAlert} input. */
export function useFormStatusFromSearch(): FormStatus | null {
  const search = useSearch({ strict: false }) as { ok?: string; error?: string }
  const params = new URLSearchParams()
  if (search.error) params.set('error', search.error)
  else if (search.ok) params.set('ok', search.ok)
  return readFormStatus(params)
}
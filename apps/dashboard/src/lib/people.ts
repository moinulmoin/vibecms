/** How the dashboard names a person or agent in lists and headers. */

type Me = { email?: string | null; name?: string | null } | null | undefined

const EMAIL = /^[^\s@]+@[^\s@]+$/

/**
 * "You" for the signed-in user (matched by email, which is unique); otherwise
 * the stored name. Human actors with
 * no display name are stored as their email: show the part before "@" (and
 * before any "+tag"), never the full address.
 */
export function personLabel(name: string | null | undefined, me?: Me): string {
  const value = name?.trim() ?? ''
  if (!value) return 'Someone'
  const lower = value.toLowerCase()
  // Only an exact email match is identity; display names aren't unique.
  if (me?.email && lower === me.email.toLowerCase()) return 'You'
  if (EMAIL.test(value)) return value.split('@')[0]!.split('+')[0]!
  return value
}

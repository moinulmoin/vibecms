/** Plain-language messages for post mutation codes. Never show raw codes. */
const MESSAGES: Record<string, string> = {
  slug_conflict: 'Another post already uses this URL. Change the slug in post settings.',
  version_conflict: 'This post changed somewhere else while you were editing.',
  billing_required: 'The free plan includes 5 published posts. Upgrade to publish more.',
  image_alt_required: 'Every image needs alt text before this can go live. Add a short description to each image.',
  invalid_cover_asset: 'That cover image is no longer in your media library. Pick another one.',
  not_found: 'This post no longer exists.',
  owner_required: 'Only the site owner can do that.',
  upload_too_large: 'That image is too large to upload.',
}

export function postErrorMessage(code: string | undefined, action: 'save' | 'publish' | 'archive' | 'restore' = 'save'): string {
  if (code && MESSAGES[code]) return MESSAGES[code]
  const verb = action === 'save' ? 'save' : action
  return `Could not ${verb} right now. Your writing is safe here — try again in a moment.`
}

export class PostActionError extends Error {
  constructor(
    readonly code: string,
    action: 'save' | 'publish' | 'archive' | 'restore',
  ) {
    super(postErrorMessage(code, action))
    this.name = 'PostActionError'
  }
}

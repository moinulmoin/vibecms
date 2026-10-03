/** Review state shared by the posts list, overview, and editor. */

type ReviewInput = {
  status: string
  versionNumber?: number | null
  publishedVersionNumber?: number | null
  latestActorType?: string | null
}

export function isAgentActor(type: string | null | undefined): boolean {
  return type === 'agent' || type === 'api_key'
}

/** A live post whose private tip moved past the live version. */
export function hasPendingChanges(post: ReviewInput): boolean {
  return (
    post.status === 'published' &&
    post.publishedVersionNumber != null &&
    post.versionNumber != null &&
    post.versionNumber > post.publishedVersionNumber
  )
}

/** Waiting on a human: agent drafts, or live posts with unpublished changes. */
export function needsReview(post: ReviewInput): boolean {
  if (hasPendingChanges(post)) return true
  return post.status === 'draft' && isAgentActor(post.latestActorType)
}

/** Short label for the review badge; null when nothing is waiting. */
export function reviewLabel(post: ReviewInput): string | null {
  if (hasPendingChanges(post)) return 'Unpublished changes'
  if (post.status === 'draft' && isAgentActor(post.latestActorType)) return 'Agent draft'
  return null
}

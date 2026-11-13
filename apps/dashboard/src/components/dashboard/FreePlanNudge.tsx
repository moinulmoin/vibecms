import { FREE_CLOSE_MARKS, FREE_TIER } from '@vc/config'
import { useState } from 'react'
import { Button } from '@vc/ui'
import { GetCloudButton } from '~/components/dashboard/PlanActions'

type Kind = keyof typeof FREE_CLOSE_MARKS

function dismissKey(siteKey: string, kind: Kind) {
  return `vc-free-close:${siteKey}:${kind}`
}

function readDismissed(siteKey: string, kind: Kind): boolean {
  try {
    return window.localStorage.getItem(dismissKey(siteKey, kind)) === '1'
  } catch {
    return false
  }
}

/** What is left of a cap once usage reached its "getting close" mark; null before the mark or at the cap. */
function leftAfterMark(kind: Kind, used: number): number | null {
  return used >= FREE_CLOSE_MARKS[kind] && used < FREE_TIER[kind] ? FREE_TIER[kind] - used : null
}

/**
 * The free plan on the overview, one calm line with Get Cloud, never a modal:
 * - From 20 of 25 published posts or 80 of 100 images: what is left. Dismissing
 *   it keeps it away for this blog and that cap.
 * - At 25 of 25 or 100 of 100: that the limit is reached. Not dismissible, so
 *   the owner learns it here before a publish or upload is refused.
 */
export function FreePlanNudge({ siteKey, publishedPosts, images }: { siteKey: string; publishedPosts: number; images: number }) {
  const [dismissed, setDismissed] = useState(() => ({
    publishedPosts: readDismissed(siteKey, 'publishedPosts'),
    images: readDismissed(siteKey, 'images'),
  }))
  const reached = [
    publishedPosts >= FREE_TIER.publishedPosts ? `${FREE_TIER.publishedPosts} published posts` : null,
    images >= FREE_TIER.images ? `${FREE_TIER.images} images` : null,
  ].filter(Boolean)
  if (reached.length) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] leading-6">
        <p className="min-w-0 text-muted-foreground">
          <span className="font-medium text-foreground">You’ve reached {reached.join(' and ')} on Free.</span> Everything you published stays online.
        </p>
        <GetCloudButton />
      </div>
    )
  }

  const postsLeft = dismissed.publishedPosts ? null : leftAfterMark('publishedPosts', publishedPosts)
  const imagesLeft = dismissed.images ? null : leftAfterMark('images', images)
  if (postsLeft === null && imagesLeft === null) return null

  const parts = [
    postsLeft === null ? null : `${postsLeft} published ${postsLeft === 1 ? 'post' : 'posts'}`,
    imagesLeft === null ? null : `${imagesLeft} ${imagesLeft === 1 ? 'image' : 'images'}`,
  ].filter(Boolean)

  function dismiss() {
    for (const kind of ['publishedPosts', 'images'] as const) {
      if ((kind === 'publishedPosts' ? postsLeft : imagesLeft) === null) continue
      try {
        window.localStorage.setItem(dismissKey(siteKey, kind), '1')
      } catch {
        // Private mode: dismissed for this visit only.
      }
    }
    setDismissed({ publishedPosts: dismissed.publishedPosts || postsLeft !== null, images: dismissed.images || imagesLeft !== null })
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem] leading-6">
      <p className="min-w-0 text-muted-foreground">
        <span className="font-medium text-foreground">{parts.join(' and ')} left on Free.</span> Everything you published stays online.
      </p>
      <GetCloudButton />
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  )
}

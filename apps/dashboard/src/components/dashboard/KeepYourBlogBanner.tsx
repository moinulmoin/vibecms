import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@vc/ui'
import {
  claimMessage,
  servingMessage,
  useClaimWindowState,
  useServingState,
  type ClaimWindow,
} from '~/lib/claim-window'
import { billingQuery } from '~/lib/queries'
import type { ServingState } from '~/types/dashboard'

/**
 * "Keep your blog" notice above every dashboard page, shown while an
 * AutoSEOPilot-sponsored blog waits to be claimed: the plan ended, the blog
 * is online for a few more days and then pauses, and an unclaimed blog is
 * deleted on the deadline. Claiming it is a vibecms Cloud upgrade on this
 * same workspace — the same blog, posts and domain, nothing moves.
 *
 * A blog that was claimed and later lost its subscription has no deadline
 * (it is never deleted), but its visitors can still see the paused page; the
 * notice then explains that instead, without a deletion date.
 */
export function KeepYourBlogBanner({ siteName }: { siteName?: string }) {
  const { data } = useQuery(billingQuery)
  const claim: ClaimWindow | null = data && !data.selfHosted ? data.claim : null
  const serving: ServingState | null = data && !data.selfHosted ? data.serving : null
  const state = useClaimWindowState(claim)
  const servingNow = useServingState(serving)
  if (!data || data.selfHosted) return null
  const blogName = siteName ?? 'This blog'

  if (claim) {
    // Past the deadline the blog is gone or on its way out; a "keep it by
    // then" notice would be a lie, so the banner steps aside.
    if (state === null || state === 'expired') return null
    return (
      <Notice
        label="Keep your blog"
        message={claimMessage(claim, state, blogName)}
        isOwner={data.isOwner}
        action="Keep my blog"
        ownerNote="Ask the workspace owner to upgrade and keep this blog."
      />
    )
  }

  const message = serving && servingNow ? servingMessage(serving, servingNow, blogName) : null
  if (!message) return null
  return (
    <Notice
      label={servingNow === 'paused' ? 'Your blog is paused' : 'Your blog pauses soon'}
      message={message}
      isOwner={data.isOwner}
      action="Subscribe again"
      ownerNote="Ask the workspace owner to subscribe again to keep this blog online."
    />
  )
}

function Notice({
  label,
  message,
  isOwner,
  action,
  ownerNote,
}: {
  label: string
  message: string
  isOwner: boolean
  action: string
  ownerNote: string
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border border-border px-4 py-3"
    >
      <p className="min-w-0 text-[0.9375rem] leading-6 text-foreground">{message}</p>
      {isOwner ? (
        <Button asChild size="sm">
          <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
            {action}
          </Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{ownerNote}</p>
      )}
    </section>
  )
}

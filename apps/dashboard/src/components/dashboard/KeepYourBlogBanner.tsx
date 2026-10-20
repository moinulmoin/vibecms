import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '@vc/ui'
import { claimMessage, useClaimWindowState, type ClaimWindow } from '~/lib/claim-window'
import { billingQuery } from '~/lib/queries'

/**
 * "Keep your blog" notice above every dashboard page, shown while an
 * AutoSEOPilot-sponsored blog waits to be claimed: the plan ended, the blog
 * is online for a few more days and then pauses, and an unclaimed blog is
 * deleted on the deadline. Claiming it is a vibecms Cloud upgrade on this
 * same workspace — the same blog, posts and domain, nothing moves.
 */
export function KeepYourBlogBanner({ siteName }: { siteName?: string }) {
  const { data } = useQuery(billingQuery)
  const claim: ClaimWindow | null = data && !data.selfHosted ? data.claim : null
  const state = useClaimWindowState(claim)
  if (!data || data.selfHosted || !claim || state === null) return null
  // Past the deadline the blog is gone or on its way out; a "keep it by then"
  // notice would be a lie, so the banner steps aside.
  if (state === 'expired') return null

  return (
    <section
      aria-label="Keep your blog"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border border-border px-4 py-3"
    >
      <p className="min-w-0 text-[0.9375rem] leading-6 text-foreground">
        {claimMessage(claim, state, siteName ?? 'This blog')}
      </p>
      {data.isOwner ? (
        <Button asChild size="sm">
          <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
            Keep my blog
          </Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Ask the workspace owner to upgrade and keep this blog.</p>
      )}
    </section>
  )
}

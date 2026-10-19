# 028 - Plans, pricing, and ownership after AutoSEOPilot

Status: DECIDED, NOT BUILT (founder, 2026-10-19 and 2026-10-22). Decision record, not a release or implementation proof. Existing capabilities below are context; the new contract has not shipped. Roadmap additions and removals live in [FEATURES.md](../docs/FEATURES.md#planned), not duplicated here.

vibecms launches publicly on 2026-10-22 on the build already in production. Nothing in this doc is part of that launch.

## Positioning and plans

Agentic CMS: agent-first, works for people too. Anything that costs us per use is paid-only.

| Offer | Decided contract |
|---|---|
| Try free | CTA everywhere: **Try free**. 5 published posts, 10 images, not indexed, no own domain, limited agent access, deterministic SEO check. Add a **Published with VibeCMS** badge (not built yet); remove the signup form from Try. |
| Cloud | Keep the name Cloud (not the considered Pro rename) and today's price display: ~~$15/month~~ **$9/month**, ~~$150/year~~ **$75/year**. Unlimited posts and visitors; indexing; own domain or `/blog` subfolder; no badge; **10 GB** media (up from today's 5 GB); reader + AI-agent analytics; signup form for audience capture. Unlimited agent MCP/API/CLI calls with guardrails: keep per-minute and per-day write caps, drop monthly call caps. |
| Self-hosting | Stays free. |

## AutoSEOPilot cancellation and claim

Sponsorship ends immediately on cancellation, with no grace. Keep the site, posts, media, domain rows, and owner access. The owner claims the same blog and domain by signing in with the same email and buying Cloud; no migration. Delete it if unclaimed after 30 days.

Built since on main as [plan 027](027-keep-your-blog-claim.md) (not yet in production): the blog stays live for 7 days, then shows a paused page, and is deleted after 30 days if unclaimed. That replaces "no grace" above. Restoring the custom domain after a Cloud purchase still needs the dev proof listed in 027.

## Import and component boundary

Agent-driven import from WordPress, Ghost, Outrank, Markdown, or HTML via MCP works today; this is not the unbuilt managed-import workflow in plan 026. Gaps: old-URL redirects (026, on hold), image re-upload, and no MDX support.

Record the idea of [mdxcn](https://www.mdxcn.dev) ([shadcn-labs/mdxcn](https://github.com/shadcn-labs/mdxcn)): Markdown-friendly components such as callouts, steps, terminals, charts, and timelines so an agent can place a figure beside prose. Any support would be an allowlisted component set, not general MDX execution; the safety boundary is recorded under Skipped in the feature ledger. This is a recorded direction, not built support.

## Cost notes (USD per Cloud blog per month)

Planning estimates, not measured bills or margin guarantees. Included allowances are shared across the account, not granted to each blog.

| Cost | Source and assumption |
|---|---|
| Polar on $9 | About **$1.10** worst case: new-org Starter 5% + $0.50, plus 1.5% international = $1.085. Early-member pricing is 4% + 0.5% subscription + $0.40 (plus applicable international fee). [Polar pricing](https://polar.sh/resources/pricing). |
| Custom hostname | **$0.10** after 100 free hostnames. [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/). |
| R2 storage | **$0.015/GB-month**, so 10 GB = **$0.15**, before account allowances and billing rounding. [R2 pricing](https://developers.cloudflare.com/r2/pricing/). |
| Image resizing | Four widths per image (`MEDIA_RESPONSIVE_WIDTHS`, `apps/public/src/lib/media-assets.ts`); **$0.50/1,000 unique transformations/month** after 5,000 free per account. Budget about **$0.002 per image viewed per month** if all four widths are requested, not per view. Images Free rejects new transformations above 5,000/month; `media.ts` falls back to original bytes. An Images Paid plan is needed as we grow. [Images pricing](https://developers.cloudflare.com/images/pricing/). |
| Worker requests | **$0.30/million** after 10 million included. A page view is several requests: page, analytics beacon, each image. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |
| Analytics Engine | **$0.25/million writes** after 10 million included; not billed yet. [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/). |
| Account base | Workers Paid **$5/month per account**, not per blog. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |

Founder planning estimate: a typical Cloud blog with 100 images and 100,000 views costs about **$1.80/month**, about **80% margin at $9**. This is a rough operating estimate, not a complete billing model (CPU, database/operation usage, request mix, and shared-base allocation vary). Tail risk: thousands of distinct images all viewed monthly can exceed $9; 5,000 images × four requested widths is about **$10/month** of marginal resizing before the account's shared free allowance ($7.50 if that entire allowance is still available).

## Founder decisions, 2026-10-22

1. **Analytics stays Cloud-only.** Confirmed. Already gated in code: `apps/api/src/server/operations.ts:327` returns `ANALYTICS_PAID_PLAN` (402) for locked sites.
2. **The AI SEO review becomes a per-article "SEO & GEO check", with no AI model of ours.**
   - Code rules run on every plan, Try free included. The code already has 26 rules, including the 5 focus-keyword rules (`SEO_FINDING_CODES`, `packages/content/src/seo-checks.ts:36-63`: 21 general + `keyword-title`, `keyword-slug`, `keyword-intro`, `keyword-heading`, `keyword-description`). Only the GEO rules (for AI answers) are new. Proposed: the answer comes in the first paragraph; numbers link to a source; a "last updated" date; steps and comparisons in lists or tables; sections short enough to quote.
   - Judgment questions go in a new skill, `vibecms-seo` (covers search engines and AI answers). Examples: "does the opening answer the title?", "which claims need a source?", "does this section make sense quoted on its own?". The customer's own agent runs the code check, then answers these with its own AI. That costs us nothing.
   - Remove the Workers AI review: `apps/api/src/server/seo-review.ts`, `packages/db/src/repositories/seo-reviews.ts`, the `ai: true` option on `posts.seo_check`, the `AI` binding in `apps/api/wrangler.jsonc`, and the related docs and privacy text. Its title and description suggestions go too: the platform checks, the agent writes.
3. **Add a CLI command and an MCP call to fetch the core skills** (`skills/vibecms-core`, `skills/vibecms-writing`, later `vibecms-seo`). Today agents get them with `npx skills add moinulmoin/vibecms` or from `/.well-known/agent-skills/` (`apps/public/src/pages/.well-known/[...path].ts`).
4. **Skills are free, for everyone.** "Skills updated from the users" means we keep improving our skills and every agent gets the newest version (this already works). No per-customer skill rules.
5. **Skill names keep the `vibecms-` prefix.** Installed skills share one folder with other vendors' skills, so a bare `core` or `writing` would collide.

## Checked against the code (2026-10-22)

- **Subscriber download is built.** Owner-only CSV export at `GET /api/dashboard/subscribers/export.csv` (`apps/api/src/routes/dashboard.ts:204-218`, `apps/api/src/server/dashboard-api.ts:206-225`). It has no plan gate, so Try free owners can use it too.
- **Pricing matches the decision.** List $15/$150 (`PRICING`, `packages/config/src/index.ts:110-116`) with a $9/$75 launch offer (`LAUNCH_OFFER`, same file `:132-144`), shown as ~~$15~~ $9. The code says "Locked while you stay subscribed."
- **Paid media storage is 5 GB today** (`paidStorageBytes`, `packages/config/src/index.ts:40-41`). The target is 10 GB; not built.
- **The signup CTA says "Start free"**, not "Try free" (`apps/public/src/components/landing/hero.tsx:34`, `hosting-pricing.tsx:120`), and the email sign-in code is still required.

## Open questions

- Should the subscriber download be Cloud-only? Today every owner can use it.
- Build order. Proposed: (1) SEO & GEO check, (2) badge, (3) 10 GB of images, (4) no monthly agent-call caps, (5) Try free without the signup form. The subscriber download is already built.
- What does "Try free without the signup form" mean? The email sign-in code is still required today, and the CTA says "Start free". Does it mean dropping the sign-in step, dropping the reader signup form from free blogs, or renaming the button?
- Is $9 permanent or first-period only? The code says the rate is locked while the subscription stays active, but its comments disagree on how Polar applies it (products priced at the offer vs. 40%/50% discounts, `packages/config/src/index.ts:119-141`). Check the live Polar products and discounts.

# 028 - Plans, pricing, and ownership after AutoSEOPilot

Status: PARTIALLY SHIPPED — production 2026-10-22, main `4fd0cb4`. Founder decisions dated 2026-10-19 and 2026-10-22; shipped scope and remaining work are distinguished below. Current capabilities live in [FEATURES.md](../docs/FEATURES.md).

The production release includes the per-article SEO check, cloud-served skills, Cloud allowance changes, free-blog attribution, and the keep-your-blog claim window. Agent OAuth and directory submissions are not built/completed; removing the Try free signup form remains an open question.

## Positioning and plans

Agentic CMS: agent-first, works for people too. Anything that costs us per use is paid-only.

| Offer | Decided contract |
|---|---|
| Try free | 5 published posts, 10 images, not indexed, no own domain, limited agent access, deterministic SEO check. **Shipped:** "Published with vibecms" link on free blogs. **Open:** "Try free" CTA wording and what removing the signup form means; recommendation: keep the email sign-in code. Free-plan agent-call limits are unchanged. |
| Cloud | Keep the name Cloud (not the considered Pro rename) and today's price display: ~~$15/month~~ **$9/month**, ~~$150/year~~ **$75/year**. Unlimited posts and visitors; indexing; own domain or `/blog` subfolder; no attribution link; reader + AI-agent analytics; signup form for audience capture. **Shipped:** **10 GB** media and no monthly agent-call caps. Per-minute/day call limits and the daily write cap remain. |
| Self-hosting | Stays free. |

## AutoSEOPilot cancellation and claim

The original decision was to end sponsorship immediately on cancellation, keeping site, posts, media, domain rows, and owner access for a same-email Cloud claim, with deletion after 30 days.

**Shipped to production 2026-10-22:** [plan 027](027-keep-your-blog-claim.md) replaces the original "no grace" decision. The blog stays live for 7 days, then shows a paused page, and is deleted after 30 days if unclaimed. The owner claims the same blog and domain by signing in with the same email and buying Cloud; no migration.

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
2. **SHIPPED: per-article SEO check and `vibecms-seo`, with no AI model of ours.**
   - The deterministic check runs on every plan, Try free included: **31 rules total**, comprising the existing 26 SEO rules and **5 AI-answer rules**.
   - Judgment questions live in the free `vibecms-seo` skill, covering search engines and AI answers. The customer's own agent runs the code check, then answers judgment questions with its own model. The platform checks; the agent writes.
   - Workers AI review was removed, including its API option, binding, title/description suggestions, related documentation/privacy text, and persistence (migration **0042**).
3. **SHIPPED: fetch skills from the cloud.** `vibecms-core`, `vibecms-writing`, and `vibecms-seo` are served from `/.well-known/agent-skills/`, via MCP/REST `skills.list` and `skills.get` (**39 tools** total), and via CLI `vibecms skills list|get`. Install with `npx skills add https://vibecms.dev`.
4. **Skills are free, for everyone.** "Skills updated from the users" means we keep improving our skills and every agent gets the newest version (this already works). No per-customer skill rules.
5. **Skill names keep the `vibecms-` prefix.** Installed skills share one folder with other vendors' skills, so a bare `core` or `writing` would collide.

## Checked against the code (2026-10-22)

- **Subscriber download is built.** Owner-only CSV export at `GET /api/dashboard/subscribers/export.csv` (`apps/api/src/routes/dashboard.ts:204-218`, `apps/api/src/server/dashboard-api.ts:206-225`). It has no plan gate, so Try free owners can use it too.
- **Pricing matches the decision.** List $15/$150 (`PRICING`, `packages/config/src/index.ts:110-116`) with a $9/$75 launch offer (`LAUNCH_OFFER`, same file `:132-144`), shown as ~~$15~~ $9. The code says "Locked while you stay subscribed."
- **Paid media storage is now 10 GB**, shipped to production 2026-10-22.
- **Cloud has no monthly agent-call caps**, shipped to production 2026-10-22; free-plan limits are unchanged.
- **Free blogs show "Published with vibecms"**, shipped to production 2026-10-22.
- **Email sign-in code remains required.** Removing the Try free signup form has not shipped; recommendation: keep the email code.

## Not built / not completed

- **OAuth "Sign in with vibecms" for agents** is not built. It is needed for Claude's Connectors Directory; it is separate from human Google/GitHub sign-in.
- **Directory submissions** are not completed. The founder submits them using the kit in [directory-listings.md](../docs/directory-listings.md).

## Open questions

- Should the subscriber download be Cloud-only? Today every owner can use it.
- What does "Try free without the signup form" mean? Not built: dropping the sign-in step, dropping the reader signup form from free blogs, and renaming the CTA are different changes. Recommendation: keep the email sign-in code.
- Is $9 permanent or first-period only? The code says the rate is locked while the subscription stays active, but its comments disagree on how Polar applies it (products priced at the offer vs. 40%/50% discounts, `packages/config/src/index.ts:119-141`). Check the live Polar products and discounts.

# 028 - Plans, pricing, and ownership after AutoSEOPilot

Status: PARTIALLY SHIPPED — production 2026-10-22, main `4fd0cb4`. Founder decisions dated 2026-10-19 and 2026-10-22; shipped scope and remaining work are distinguished below. Current capabilities live in [FEATURES.md](../docs/FEATURES.md).

The production release includes the per-article SEO check, cloud-served skills, Pro allowance changes, free-blog attribution, and the keep-your-blog claim window. Agent OAuth and directory submissions are not built/completed; removing the Try free signup form remains an open question.

## Positioning and plans

Agentic CMS: agent-first, works for people too. Anything that costs us per use is paid-only.

| Offer | Decided contract |
|---|---|
| Free | **15** published posts (the 12th publish says 3 are left), 10 drafts at a time, 100 images / 250 MB, **one custom domain**, open to search engines and AI assistants, 7-day analytics totals, 300 agent calls a day and 1,000 a month, 20 redirects, the "Published with vibecms" link and the Report abuse link. Published posts above the cap stay online and editable. **Open:** "Try free" CTA wording and what removing the signup form means; recommendation: keep the email sign-in code. |
| Pro | Renamed from Cloud (2026-11-21; internal keys such as `PLAN_SUMMARY.cloud` and billing statuses keep their names). **$15/month** or **$150/year**, never more at checkout (no processing-fee surcharge). Unlimited posts and visitors; indexing; own domain; **a `/blog` path on the customer's own site (Pro only)**; no attribution link; reader + AI-agent analytics; signup form for audience capture; **10 GB** media and no monthly agent-call caps. Per-minute/day call limits and the daily write cap remain. |
| Early user offer | **$9/month or $75/year**, forever, with **no redemption cap** (founder, 2026-11-22). Two Polar discounts (`POLAR_LAUNCH_DISCOUNT_MONTHLY_ID` / `_YEARLY_ID`: $6 off monthly, $75 off yearly, duration forever) that checkout applies on its own; the copy states the price from `EARLY_USER_OFFER` and the deploy preflight checks the discounts land on it. A discount Polar refuses (deleted, ended) falls back to a list-price checkout. Removable: switch it off in Polar, then drop the vars and set `EARLY_USER_OFFER.active` to false. |
| Self-hosting | Stays free. |

## AutoSEOPilot cancellation and claim

The original decision was to end sponsorship immediately on cancellation, keeping site, posts, media, domain rows, and owner access for a same-email Pro claim, with deletion after 30 days.

**Shipped to production 2026-10-22:** [plan 027](027-keep-your-blog-claim.md) replaces the original "no grace" decision. The blog stays live for 7 days, then shows a paused page, and is deleted after 30 days if unclaimed. The owner claims the same blog and domain by signing in with the same email and buying Pro; no migration.

## Import and component boundary

Agent-driven import from WordPress, Ghost, Outrank, Markdown, or HTML via MCP works today; this is not the unbuilt managed-import workflow in plan 026. Gaps: old-URL redirects (026, on hold), image re-upload, and no MDX support.

Record the idea of [mdxcn](https://www.mdxcn.dev) ([shadcn-labs/mdxcn](https://github.com/shadcn-labs/mdxcn)): Markdown-friendly components such as callouts, steps, terminals, charts, and timelines so an agent can place a figure beside prose. Any support would be an allowlisted component set, not general MDX execution; the safety boundary is recorded under Skipped in the feature ledger. This is a recorded direction, not built support.

## Cost notes (USD per Pro blog per month)

Planning estimates, not measured bills or margin guarantees. Included allowances are shared across the account, not granted to each blog.

| Cost | Source and assumption |
|---|---|
| Polar on $15 | About **$1.48** worst case: new-org Starter 5% + $0.50, plus 1.5% international = $1.475 (less on a discounted early-user charge). Early-member pricing is 4% + 0.5% subscription + $0.40 (plus applicable international fee). [Polar pricing](https://polar.sh/resources/pricing). |
| Custom hostname | **$0.10** after 100 free hostnames. [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/). |
| R2 storage | **$0.015/GB-month**, so 10 GB = **$0.15**, before account allowances and billing rounding. [R2 pricing](https://developers.cloudflare.com/r2/pricing/). |
| Image resizing | Four widths per image (`MEDIA_RESPONSIVE_WIDTHS`, `apps/public/src/lib/media-assets.ts`); **$0.50/1,000 unique transformations/month** after 5,000 free per account. Budget about **$0.002 per image viewed per month** if all four widths are requested, not per view. Images Free rejects new transformations above 5,000/month; `media.ts` falls back to original bytes. An Images Paid plan is needed as we grow. [Images pricing](https://developers.cloudflare.com/images/pricing/). |
| Worker requests | **$0.30/million** after 10 million included. A page view is several requests: page, analytics beacon, each image. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |
| Analytics Engine | **$0.25/million writes** after 10 million included; not billed yet. [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/). |
| Account base | Workers Paid **$5/month per account**, not per blog. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |

Founder planning estimate: a typical Pro blog with 100 images and 100,000 views costs about **$1.80/month**, about **88% margin at $15** (less while an early-user discount applies). This is a rough operating estimate, not a complete billing model (CPU, database/operation usage, request mix, and shared-base allocation vary). Tail risk: thousands of distinct images all viewed monthly can exceed the price; 5,000 images × four requested widths is about **$10/month** of marginal resizing before the account's shared free allowance ($7.50 if that entire allowance is still available).

## Founder decisions, 2026-11-21 (MOI-342)

Confirmed before the VibeCMS production deploy: rename Cloud to **Pro**; move the `/blog` subfolder to Pro and keep one custom domain on Free; Free publishes **15** posts (notice at 12), with posts already published above 15 staying online and editable; base price **$15/month or $150/year** with a removable **Early user** Polar discount that brings it to $9/$75 for early users, with no redemption cap; no processing-fee surcharge; MCP answers keep naming no plan and linking only to the pricing section.

Connecting a `/blog` path on Free is refused with `BILLING_REQUIRED` (agents get the pricing link); a path that is already connected keeps serving on any plan, like an own domain, because leaving Pro never takes anything offline.

## Founder decisions, 2026-10-22

1. **Analytics stays Pro-only.** Confirmed. Already gated in code: `apps/api/src/server/operations.ts:327` returns `ANALYTICS_PAID_PLAN` (402) for locked sites.
2. **SHIPPED: per-article SEO check and `vibecms-seo`, with no AI model of ours.**
   - The deterministic check runs on every plan, Try free included: **31 rules total**, comprising the existing 26 SEO rules and **5 AI-answer rules**.
   - Judgment questions live in the free `vibecms-seo` skill, covering search engines and AI answers. The customer's own agent runs the code check, then answers judgment questions with its own model. The platform checks; the agent writes.
   - Workers AI review was removed, including its API option, binding, title/description suggestions, related documentation/privacy text, and persistence (migration **0042**).
3. **SHIPPED: fetch skills from the cloud.** `vibecms-core`, `vibecms-writing`, and `vibecms-seo` are served from `/.well-known/agent-skills/`, via MCP/REST `skills.list` and `skills.get` (**39 tools** total), and via CLI `vibecms skills list|get`. Install with `npx skills add https://vibecms.dev`.
4. **Skills are free, for everyone.** "Skills updated from the users" means we keep improving our skills and every agent gets the newest version (this already works). No per-customer skill rules.
5. **Skill names keep the `vibecms-` prefix.** Installed skills share one folder with other vendors' skills, so a bare `core` or `writing` would collide.

## Checked against the code (2026-10-22)

- **Subscriber download is built.** Owner-only CSV export at `GET /api/dashboard/subscribers/export.csv` (`apps/api/src/routes/dashboard.ts:204-218`, `apps/api/src/server/dashboard-api.ts:206-225`). It has no plan gate, so Try free owners can use it too.
- **Pricing (updated 2026-11-21).** List $15/$150 (`PRICING` in `packages/config/src/index.ts`); the hard-coded $9/$75 launch offer is now the removable early-user Polar discount at the same $9/$75 (`EARLY_USER_OFFER`, same file).
- **Paid media storage is now 10 GB**, shipped to production 2026-10-22.
- **Pro has no monthly agent-call caps**, shipped to production 2026-10-22.
- **Free blogs show "Published with vibecms"**, shipped to production 2026-10-22.
- **Email sign-in code remains required.** Removing the Try free signup form has not shipped; recommendation: keep the email code.

## Not built / not completed

- **OAuth "Sign in with vibecms" for agents** is not built. It is needed for Claude's Connectors Directory; it is separate from human Google/GitHub sign-in.
- **Directory submissions** are not completed. The founder submits them using the kit in [directory-listings.md](../docs/directory-listings.md).

## Open questions

- Should the subscriber download be Pro-only? Today every owner can use it.
- What does "Try free without the signup form" mean? Not built: dropping the sign-in step, dropping the reader signup form from free blogs, and renaming the CTA are different changes. Recommendation: keep the email sign-in code.

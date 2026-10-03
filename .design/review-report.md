# Launch UX Review

Date: 2026-08-15
Scope: marketing landing, pricing, sign-in/OTP, first-time setup, agent connection, first publish, responsive behavior, accessibility, and launch-message consistency.

## Executive verdict

**Yes, the complete acquisition path needed review before announcements.**

The product already has a strong, distinctive visual foundation. The landing page communicates the agent-first value proposition clearly, the brand system is disciplined, the live product works, and the core auth/onboarding mechanics are substantially more resilient than a typical early-stage launch.

There are **no P0 usability blockers** in the reviewed path. The main launch risk is not visual quality. It is a gap between the story that will be announced and the contract currently shown to users:

- the founding first-100 offer is not implemented or explained,
- the free-plan boundary is disclosed only after sign-in,
- the three-step onboarding promise disappears after step one,
- the sign-in brand link does not return to the marketing site,
- the public footer lacks basic legal/support trust links,
- one prominent MCP capability count is inaccurate for the shown token scope,
- the launch rehearsal documentation still contains obsolete pricing and deferred-work claims.

**Overall score: 3.0 / 4.0.**

Recommendation: ship a focused launch-finish pass before public announcements, then run one narrow responsive/accessibility verification pass.

## Evidence reviewed

### Runtime

- Production landing at 1440×900, 720×900, 390×844, and 320×700.
- Production sign-in at 1440×900 and 390×844.
- Desktop and mobile pricing sections.
- Keyboard tab sequence and visible-focus behavior.
- Reduced-motion emulation.
- Horizontal overflow and document-width checks.
- Static contrast calculations for the shipped light/dark tokens.

Evidence artifacts:

- `artifacts/design-review/landing-desktop.png`
- `artifacts/design-review/landing-mobile-cdp.png`
- `artifacts/design-review/landing-320.png`
- `artifacts/design-review/pricing-desktop-section.png`
- `artifacts/design-review/pricing-mobile-section.png`
- `artifacts/design-review/login-desktop.png`
- `artifacts/design-review/login-mobile-cdp.png`
- `artifacts/design-review/runtime-audit.json`

### Source

- Marketing page composition, hero, navigation, pricing, FAQ, footer, and interactions.
- Sign-in and OTP states.
- Blog setup, onboarding frame, connect flow, first-draft state, first-live state, and dashboard first-success state.
- Shared design tokens, focus treatment, reduced-motion behavior, and input sizing.
- Current launch/pricing configuration and launch rehearsal documentation.

## What should be preserved

1. **The hero is strong and specific.** “CMS for AI agents” plus scoped MCP and owner control is immediately legible and consistent with `PRODUCT.md`.
2. **The brand is recognizable.** The terminal identity, restrained green, Geist/Geist Mono pairing, and dark technical surface do not look like a generic SaaS template.
3. **The landing demonstrates the mechanism.** The agent-to-publication animation makes the core workflow tangible instead of relying on a feature list.
4. **The trust story is visible.** Scoped access, blocked capabilities, versions, activity, and approval-first prompts reinforce control.
5. **The sign-in flow is simple.** Email OTP is understandable, passwordless, properly labeled, recoverable, and does not ask for unnecessary information.
6. **The connect flow handles real states.** Loading, errors, one-time token reveal, connection waiting, stalled/recovery guidance, draft review, first-live proof, and revocation are all represented.
7. **Responsive fundamentals are sound.** No horizontal overflow was detected at 320, 390, 720, or 1440 CSS pixels.
8. **Accessibility foundations are sound.** Heading hierarchy is orderly, focus treatment exists, alerts use live-region semantics, and reduced motion resolves all reviewed reveal animations to visible static content.
9. **Contrast is comfortably above the project target.** Calculated examples:
   - dark muted text on dark background: 8.14:1,
   - dark muted text on card: 7.49:1,
   - light muted text on light background: 6.83:1.

## Scorecard

Scale: 0 = absent/broken, 1 = major rework, 2 = functional but launch-weak, 3 = strong with focused gaps, 4 = exemplary.

| Area | Score | Verdict |
| --- | ---: | --- |
| Agent-first product story | 3.7 | Clear, specific, and demonstrated visually. |
| Visual identity and craft | 3.6 | Distinctive and disciplined; preserve the current direction. |
| Pricing and offer comprehension | 2.0 | Standard pricing is clear, but the selected launch offer and shared first-100 contract are absent. |
| Sign-in and OTP | 3.2 | Clean and resilient; trust/navigation continuity needs work. |
| First-time onboarding | 2.7 | Functional and state-aware, but journey progress breaks after setup. |
| First-success experience | 3.2 | Draft review and live proof are strong; the transition should feel more continuous. |
| Responsive behavior | 3.3 | No overflow and good stacking; mobile discovery navigation is missing. |
| Accessibility | 3.4 | Good AA foundation; long-page bypass and small-target polish remain. |
| Trust and launch readiness | 2.2 | Legal/support links, offer disclosure, copy accuracy, and launch docs need correction. |

## Findings

### P0

No P0 findings.

### P1: Fix before public announcements

#### 1. The selected founding offer does not exist in the user-facing journey

The approved launch contract is:

- standard: **$19/month** or **$190/year**,
- founding: **$13/month** or **$99/year**,
- first 100 customers across both billing intervals,
- discount shown separately at checkout,
- founding rate retained while continuously subscribed.

The shipped configuration and pricing UI expose only standard pricing:

- `packages/config/src/index.ts:44-50`
- `apps/public/src/components/landing/hosting-pricing.tsx:40-63`
- `apps/dashboard/src/components/dashboard/BillingPage.tsx:147-247`
- `apps/dashboard/src/components/dashboard/ConnectPage.tsx:112-158`

There is also no “Public Early Access” status or first-100 eligibility explanation on marketing, sign-in, onboarding, or billing.

**Impact:** announcement copy would promise a commercial offer the product does not show or reliably enforce.

**Fix:** keep standard prices as the visual anchor, add a compact founding-offer module, auto-apply separate Polar monthly/yearly discounts, and enforce a shared VibeCMS first-100 eligibility counter before checkout creation. Show the discount as a checkout line item, not as a replacement product price.

#### 2. “Start free” does not disclose the free boundary until after sign-in

Marketing says “Start free,” “no card,” and “see it publish,” but does not state the actual hosted trial boundary. Setup later reveals:

> “Draft for free and publish your first 5 posts to try it live. Subscribe to publish more and upload media.”

Evidence:

- `apps/public/src/components/landing/hosting-pricing.tsx:21-63`
- `apps/dashboard/src/components/dashboard/SetupPage.tsx:195-200`
- `apps/dashboard/src/components/dashboard/BillingPage.tsx:245-247`

**Impact:** users may interpret the pricing checklist as included in the free state, then discover media/indexing/publish limits only after activation.

**Fix:** add one precise line under the pricing CTA: “Free: drafts, agent connection, and your first 5 published posts. Upgrade for more publishing, media, indexing, analytics, and custom domains.” Keep the full entitlement list attached to the paid plan.

#### 3. The sign-in brand link does not return users to the marketing site

The logo link uses `href="/"` on `app.vibecms.dev`:

- `apps/dashboard/src/routes/login.tsx:16-22`

The app root redirects unauthenticated users back to `/login`:

- `apps/dashboard/src/routes/index.tsx:4-10`

**Impact:** a user who wants to re-check pricing, docs, trust claims, or self-hosting is trapped in a login loop rather than returned to `vibecms.dev`.

**Fix:** add a canonical marketing-site URL to shared configuration and use it for the login/onboarding brand link. Preserve `/` only for authenticated product navigation.

#### 4. The three-step onboarding promise disappears after step one

The onboarding frame presents:

1. Blog setup
2. Connect agent
3. First post

Evidence:

- `apps/dashboard/src/components/dashboard/OnboardingFrame.tsx:6-64`
- `apps/dashboard/src/components/dashboard/SetupPage.tsx:115-206`

After setup, navigation moves to `/dashboard/connect`, but `OnboardingFrame` is not used again:

- `apps/dashboard/src/components/dashboard/SetupPage.tsx:98-103`
- `apps/dashboard/src/components/dashboard/ConnectPage.tsx:484-545`

The connect page has excellent dynamic states, but users lose the overall journey indicator precisely when the task becomes unfamiliar.

**Impact:** the product promises a short guided sequence, then visually becomes a general dashboard before the user has connected an agent or published.

**Fix:** retain a compact onboarding progress rail inside the connect route until the first post is live. Derive its state from existing connection/first-post status rather than introducing a second onboarding state machine.

#### 5. Public trust links are missing from the acquisition and auth surfaces

The footer includes Product, Explore, Resources, and Account groups, including three unrelated product links, but no Privacy, Terms, Support, Contact, or status link:

- `apps/public/src/components/landing/cta-footer.tsx:102-158`

The sign-in surface also has no legal/support route.

**Impact:** subscription, account creation, email collection, analytics, and hosted content are being offered without basic trust destinations visible in the launch path.

**Fix:** publish concise Privacy and Terms pages, expose a support contact, and link them from both the marketing footer and sign-in page. Demote or remove unrelated “Explore” links until the trust links are present.

#### 6. The scoped MCP demo overstates available tools

The product contract defines 19 total MCP operations, but tools are filtered by token scope. A Publisher preset does not include `posts:archive`, so it exposes 18 tools. The landing nevertheless says:

> “19 tools available, scoped to publish”

Evidence:

- `apps/public/src/components/landing/agent-surface.tsx:17-24`
- `apps/public/src/components/landing/agent-surface.tsx:75-78`
- `packages/api-contract/src/operations.ts:42-312`
- `apps/api/src/server/mcp.ts:245-270`

The prior live Publisher-token QA also returned 18 authorized tools.

**Impact:** the most concrete product proof contains a checkable accuracy error, which weakens the otherwise strong trust position.

**Fix:** use “18 tools available with Publisher scope,” or use “up to 19 tools” where the copy is not tied to a specific preset.

#### 7. The launch rehearsal document contains obsolete commercial and product facts

The rehearsal still says:

- monthly product: `$9/month`,
- yearly product: `$99/year`,
- custom-domain UI and real hosted config are deferred.

Evidence:

- `docs/launch-rehearsal.md:32-35`
- `docs/launch-rehearsal.md:54-59`

Current product configuration is `$19/month` and `$190/year`, and the production/custom-domain work is no longer in the state described by the document.

**Impact:** an operator following the launch checklist can validate the wrong Polar product and make decisions from stale readiness assumptions.

**Fix:** update or retire this rehearsal before the next billing test or announcement checklist is executed.

### P2: Address in the launch finish pass

#### 8. Mobile users cannot jump to pricing, features, agents, FAQ, or docs

The complete section navigation is hidden below `md`, with no compact replacement:

- `apps/public/src/components/landing/header-nav.tsx:14-29`
- `apps/public/src/components/landing/header-hero.tsx:19-54`

The measured 390px page is approximately **8,886 CSS pixels** tall.

**Impact:** mobile visitors who arrive looking for price, compatibility, or objections must scroll through the entire narrative.

**Fix:** add a compact accessible menu or a single “Explore” control. Keep Sign in and Start free visible. Do not crowd the current header.

#### 9. The launch-status copy is internally awkward

The site is already public and the selected posture is Public Early Access, but the FAQ heading still says:

> “Questions before launch.”

Evidence:

- `apps/public/src/components/landing/faq-accordion.tsx:32-37`

**Fix:** use “Questions before you start” or “Questions about early access.”

#### 10. The long landing page has no skip link

Keyboard navigation is logical and focus is visible, but the first tab stops traverse the logo and full desktop navigation before reaching the hero. The page also becomes very long on mobile/zoom.

**Fix:** add a visually-hidden “Skip to content” link that becomes visible on focus and targets the hero/main content.

#### 11. Several controls are below the preferred 44px touch height

Examples from runtime:

- marketing brand link: 30px,
- desktop nav text links: 20px,
- footer links: 40px,
- sign-in email input: 36px,
- sign-in brand link: 24px.

This is not a WCAG 2.1 AA blocker, and spacing prevents obvious target collisions, but the product otherwise uses 44px CTAs consistently.

**Fix:** increase invisible/visual hit areas where practical, especially the login input and brand links. Preserve the compact visual density.

### P3: Later polish

#### 12. The sign-in page is visually quieter than the acquisition experience

The current light product surface is clean and credible. On wide screens it also feels detached from the strong terminal identity that persuaded the user to click Start free.

**Fix:** after the functional launch work, add one quiet continuity cue, such as a restrained terminal-status line or a short control promise. Do not turn auth into a marketing split-screen.

#### 13. Unrelated product cross-promotion competes with launch trust

The footer’s Explore group promotes Ideaplexa, VoiceTypr, and ChadNext. This is not inherently wrong, but it is less useful to a first-time buyer than legal, support, security, or status links.

**Fix:** retain only after the trust/navigation hierarchy is complete, and visually demote it.

## State review

### Sign-in and OTP

Reviewed source states:

- email entry,
- optional Google sign-in,
- sending,
- request failure,
- code sent,
- OTP entry,
- incomplete-code disabled action,
- verifying,
- invalid/expired-code feedback,
- resend,
- use a different email,
- successful workspace redirect failure.

Strengths:

- correct email label and `autocomplete="email"`,
- numeric six-slot OTP,
- auto-submit at six digits,
- disabled/pending states,
- assertive error and polite success live regions through the shared Alert component,
- recovery actions remain available.

Primary issue: navigation/trust continuity, not form mechanics.

### Setup

Strengths:

- asks only for essential fields,
- optional URL provides safe local prefilling,
- touched fields are not overwritten,
- name/slug/description constraints are understandable,
- save failure is recoverable,
- billing limits are disclosed before Continue.

Primary issue: the visible three-step journey is abandoned after this route.

### Connect and first success

Strengths:

- recommended Publisher preset,
- one-time token handling,
- copyable client-specific config,
- read-only verification prompt,
- approval-first drafting prompt,
- automatic connection detection,
- waiting/stalled/recovery/revoked states,
- draft-review gate,
- first-live proof with actor and URL,
- clear continuation to Overview.

Primary issues:

- onboarding progress continuity,
- founding offer/checkout contract,
- the 18-versus-19 tool-count claim.

## Responsive and accessibility verification

### Passed

- No horizontal overflow at 320, 390, 720, or 1440 CSS pixels.
- The 320px header still fits logo, Sign in, and Start free.
- Hero CTAs stack at 320px.
- Pricing becomes a single readable column on mobile.
- Heading order remains `h1 → h2 → h3`.
- Reduced-motion emulation produced:
  - `opacity: 1`,
  - `animation: none`,
  - `transform: none`,
  - a completed static hero state.
- Dark and light text token contrast exceeds 4.5:1 in the checked combinations.
- Auth input and button focus treatment is present through shared components.
- OTP/error status is announced through shared Alert semantics.

### Needs a follow-up verification after fixes

- compact mobile navigation keyboard behavior,
- skip-link focus and scroll target,
- legal/support routes at keyboard and 200% zoom,
- founding-offer copy at 320px,
- checkout discount visibility and screen-reader naming,
- onboarding progress at narrow widths,
- touch targets after hit-area adjustments.

## Prioritized launch plan

### Now, before announcement drafts are finalized

1. Implement the shared first-100 founding eligibility and Polar discounts.
2. Add Public Early Access/founding-offer messaging while preserving standard price anchors.
3. Disclose the first-five-post free boundary on the pricing surface.
4. Fix the login marketing link and scoped MCP tool count.
5. Carry onboarding progress through connect and first publish.
6. Add Privacy, Terms, and Support destinations to marketing and auth.
7. Update the stale launch rehearsal.

### Next, before opening early access broadly

1. Complete the full Polar sandbox lifecycle: payment, webhook activation, media unlock, portal, cancellation, and state reconciliation.
2. Add compact mobile section navigation and a skip link.
3. Re-run the acquisition path with a completely new inbox/account at 390px and desktop.
4. Validate the first-100 boundary with concurrent monthly/yearly checkout attempts.

### Later

1. Add one restrained brand-continuity cue to sign-in.
2. Refine small touch targets.
3. Reconsider unrelated footer cross-promotion after the trust links are established.

## Recommended implementation modes

1. **Finish:** offer contract, copy accuracy, login escape, legal/support trust, onboarding continuity, and launch-document cleanup.
2. **Responsive:** mobile navigation, skip link, narrow offer layout, touch targets, keyboard, and 200% zoom verification.

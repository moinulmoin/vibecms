# Product

## Register

brand

> Primary surface is the marketing landing (design IS the product). The
> logged-in dashboard (`/app`, editor, settings, onboarding) is a **product**
> surface - override the register to `product` for those tasks. When in doubt,
> the surface in focus decides.

## Users

Developers, indie hackers, and small technical teams who want their AI agents to
run a blog. Their context: they already work with coding agents and MCP clients,
and they want those agents to write, draft, and publish content **without handing
over control**. They connect an agent once via a scoped `vc_` token + MCP
endpoint, then let it operate - but they expect to own every post, see every
change, and roll anything back.

The job to be done: *"Let my agents publish content for me, on infrastructure I
trust, while I stay the owner of record."*

## Product Purpose

VibeCMS is a CMS built for AI agents. Agents write, draft, and publish through
MCP over plain HTTPS + a bearer token. REST stays read/list only; every mutation
creates an activity record, and meaningful post changes create versions. It ships
two ways from one repo: hosted **VibeCMS Cloud** (Polar billing) and a real
**self-host mode** (`SELF_HOSTED=true`) on the operator's own Cloudflare D1/R2.

Success looks like: a developer connects an agent in minutes, watches it publish,
and trusts the system because control (versions, activity, scoped tokens,
ownership) is visible and real - not a feature list, a felt guarantee.

## Brand Personality

Dark dev-tool with a terminal/prompt identity. Three words: **technical,
controlled, confident**. The voice is precise and unhurried - it shows rather
than tells, and never oversells. Emotional goals: **confidence** (this is built
by people who know the stack), **control** (you are always the owner), and
**trust** (open, auditable, reversible). Copy is tight - no filler, no hype,
"delete 30%".

## Anti-references

- **Generic SaaS template.** No gradient hero + three-identical-card grid +
  pastel illustration. No Stripe-clone purple. No hero-metric template.
- **Maximalist / loud.** No big saturated green panels or cards, no neon
  overload, no decorative busywork. Green stays a rare accent.
- **Corporate enterprise.** No heavy chrome, no dense enterprise-admin clutter,
  no blue-corporate palette, no stock-photo business imagery.
- **Cutesy / playful.** No mascots, emoji-heavy UI, or bubbly friendliness. This
  is a serious tool for serious builders.

## Design Principles

1. **Agent-first story.** Lead with "CMS for AI Agents." Your agents publish via
   scoped MCP; you own every post and stay in control. This narrative ranks above
   any individual visual move.
2. **You stay in control.** Versions, activity history, and scoped tokens are the
   product's soul - surface them as felt trust, not buried settings.
3. **Not less, not more - just enough.** Clean UI. Remove gratuitous 1px borders
   and dividers; only wrap genuinely interactive things in cards. No nested cards.
4. **Green is earned, never decorative.** ~8% usage - LIVE dots, active states,
   primary CTA, checkmarks, inline code/cursor. Prominence comes from size and
   placement, not from flooding the surface with color.
5. **Self-host is quiet trust, not a co-pitch.** Open source is a trust signal -
   one line / a GitHub link / an FAQ entry. Never its own headline section.
6. **Elevate within the locked brand.** The dark terminal identity, the font
   trio, and the glossy terminal icon are fixed. Push craft and intent inside
   that identity; never swap fonts or drift maximalist.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥4.5:1, large text ≥3:1 - verify especially
muted-foreground on dark surfaces. Visible focus rings (`:focus-visible` is
wired). Full keyboard navigation for the dashboard, editor, and forms.
`prefers-reduced-motion` is honored (reveal/float/blink animations already fall
back) - keep every new animation reduced-motion safe.

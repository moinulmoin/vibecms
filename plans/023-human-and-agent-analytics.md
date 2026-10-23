# 023 - One analytics view for people and agents

Status: DONE — shipped to production 2026-10-13 (migration `0034`). Shared agent classification (`packages/config/src/agents.ts`), first-party `agent_fetch` writes in the public worker, D1 rollups, the Agents dashboard view, and the `analytics.get` contract all ship. Ranges are 7/30/90/365/all; the "today" gaps below were the pre-change motivation.

## Why

AutoSEOPilot customers want to know two things: are people reading, and are AI agents
reading (and quoting) this blog? Today we only half answer either:

- People: a JS beacon (`apps/public/src/scripts/page-view.js` → `/api/analytics/view`)
  counts post views. Any bot that runs JS is counted as a person.
- Agents: AI crawler counts come from zone GraphQL (`httpRequestsAdaptiveGroups`,
  `CLOUDFLARE_ZONE_ID`) filtered by host. That misses every request that doesn't arrive on
  our zone's hostnames: `customer.com/blog` (proxied, plan 022) and custom domains on
  Cloudflare for SaaS. It also never sees Markdown fetches, `llms.txt`, feeds or sitemaps,
  which is exactly how agents read us.
- Self-hosted blogs record nothing.

## Cloudflare facts (checked 2026-10-12)

- Workers Analytics Engine: Free 100k data points written/day, 10k read queries/day;
  Paid 10M writes/month included then $0.25/M, 1M reads/month then $1/M (not billed yet).
- `request.cf.botManagement` (score, verifiedBot, signedAgent) is only set with Cloudflare
  Bot Management (Enterprise). We can't rely on it. Classification is ours: user agent,
  representation asked for, and the `Signature-Agent` header (Web Bot Auth; presence only,
  we don't verify signatures in v1).

## Design

### 1. Count agents server-side, people by beacon

- Public worker middleware writes one Analytics Engine point per tenant request that is
  **not a person**: GET/HEAD, status 200 or 304, tenant host (direct or proxied), and any of
  - UA matches the agent table (below), or
  - representation is Markdown (`.md`, `?format=md`, `Accept: text/markdown`), or
  - path is `llms.txt`, `llms-full.txt`, `feed.xml`, `sitemap.xml`, `robots.txt`, or
  - `Signature-Agent` header present.
- People keep the beacon (bots rarely run it, and it honours DNT/GPC). The beacon handler
  drops requests whose UA matches the agent table, so JS-running crawlers stop inflating views.
- Writes go through `ctx.waitUntil` and never delay or fail the response.

### 2. One agent table

Move `AI_CRAWLERS` / `AI_REFERRERS` from `apps/api/src/server/analytics.ts` to
`packages/config/src/agents.ts` so both workers share it. Each entry:
`{ id, label, operator, category, match }` where category is one of
`ai-assistant` (fetches for a person right now: ChatGPT-User, Claude-User, Perplexity-User,
MistralAI-User, DuckAssistBot), `ai-search` (OAI-SearchBot, Claude-SearchBot, PerplexityBot),
`ai-training` (GPTBot, ClaudeBot, CCBot, Bytespider, meta-externalagent, Applebot-Extended…),
`search-engine` (Googlebot, Bingbot, Applebot, DuckDuckBot, YandexBot), `other-bot` (generic
`bot|crawler|spider|fetch|curl|python-requests|Go-http-client`), `unknown-agent` (no UA
match but Markdown/llms/feed/signature signals).

### 3. Data point layout (dataset unchanged, new event)

`indexes: [siteId]`,
`blobs: ["agent_fetch", postId|"", resource, agentId, category, representation, signed, host]`,
`doubles: [1]`. `resource` ∈ `post|index|tag|search|llms|feed|sitemap|robots|other`;
`representation` ∈ `html|markdown|xml|text`; `signed` ∈ `"1"|""`; `host` is the customer-facing
host (`customer.com` for proxied). `page_view` points are unchanged.

### 4. Rollup and storage

- `analytics-rollup.ts` reads `agent_fetch` from AE (same 2-day lookback) and writes rollup
  rows with new kinds `agent` (dimension = agentId), `agent_category`, `agent_post`
  (dimension = postId) and `agent_resource`. Migration `0034` rebuilds the
  `analytics_rollups.kind` CHECK to allow them (table rebuild like 0033; copy rows).
- Zone-GraphQL crawler counting stays as a read-only fallback for days before 023 shipped
  (existing `crawler` rows), and is no longer queried for new days.
- Post-launch reliability (migration `0043`): the existing 15-minute cron now
  drains oldest-unrolled sites under a counted 250-query budget, seven dates
  per site per tick. Each day atomically commits its rows and durable cursor;
  completed sites skip until the next UTC day. The normal overlap is unchanged.
  Retention compacts at most 20 site/months per tick. Claims (500), analytics
  (250) and media recovery (201 worst case) total at most 951 D1 calls.
  See `docs/self-hosting.md` for before/after query math and budget events.

### 5. Self-host

Collection and the dashboard work when the `ANALYTICS` binding and
`ANALYTICS_ACCOUNT_ID`/`ANALYTICS_API_TOKEN` are configured; otherwise the page says how to
turn it on (`docs/self-host`). Free-plan budget note in docs: ~100k events/day.

### 6. What people see (dashboard Analytics page)

Two tabs on the same range picker, same chart component:
- **People**: views, trend, top posts, referrers (AI referrals flagged, as today).
- **Agents**: fetches, trend split by category, top agents (label + operator), top posts read by
  agents, Markdown share ("62% of agent reads used Markdown"), `llms.txt` reads, signed share.
- The metric strip gains "Agent reads" next to "Views". Empty state explains what counts.
- Each post's editor rail shows "Last 30 days: 1.2k views, 340 agent reads" (one query, cached).

### 7. What agents see (MCP/REST)

- `analytics.get` gains `agents: { total, byCategory[], topAgents[], topPosts[], markdownShare,
  llmsReads }` and accepts optional `postId` to scope everything to one post.
- REST mirrors it (`GET /api/v1/analytics?postId=`). OpenAPI + format of the tool description
  updated. Paid gating unchanged (`ANALYTICS_PAID_PLAN`), self-host always on.

### 8. Privacy

No cookies, no IPs, no full UAs stored: only the matched agent id/category. People's
beacon keeps DNT/GPC. Document the event list on the privacy page.

## Phases

1. Shared agent table + server-side `agent_fetch` writes + beacon bot filter (apps/public, packages/config).
2. Migration 0034 + rollup kinds + `loadAnalyticsForApp` agents section + MCP/REST.
3. Dashboard Agents tab, metric strip, editor rail numbers.
4. Docs (analytics page, privacy, self-host).

## Verification

- Unit: classifier table (each category, Markdown/llms/signature signals, normal browsers are
  never agents), data point layout, rollup aggregation, kind CHECK accepts new kinds.
- Worker tests: proxied and direct agent requests both write with the customer host; HTML
  browser GET writes nothing; write failure doesn't change the response.
- Dev: curl with `ChatGPT-User` UA and `Accept: text/markdown` on basedui.dev, see it in the
  Agents tab after rollup (`/__scheduled`).

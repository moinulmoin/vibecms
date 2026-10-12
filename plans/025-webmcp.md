# 025 - WebMCP: agents in the browser drive the dashboard

Status: TODO. Best after 024 (exposes the SEO check too). No migration.

## Why

Agents operating the dashboard is the product direction. MCP needs an agent key; WebMCP
lets an agent running in the person's own browser (Chrome's built-in agent, extensions) use
the dashboard through tools the page registers, with the person's session and in front of
them. No key, no scraping the DOM.

## Platform facts (checked 2026-10-12)

- Spec (W3C Web Machine Learning CG draft): `document.modelContext.registerTool(tool, { signal })`
  where `tool = { name, description, inputSchema, execute(args) }` and `execute` returns
  `{ content: [{ type: "text", text }] }`. Unregister by aborting the signal. `toolchange`
  event. Cross-origin iframes need `allow="tools"`.
- Chrome: origin trial (Chrome 149 → ~156). Chrome 152 removed `navigator.modelContext`;
  only `document.modelContext` exists. A declarative form API is not in the spec.
- Near-zero adoption so far. Ship as progressive enhancement: feature-detect, do nothing when
  absent.

## Design

### 1. Dashboard tools (`apps/dashboard/src/lib/webmcp.ts`)

- Registered after sign-in once a site is selected; all aborted on sign-out or site switch.
- Each tool calls the existing dashboard API (`dashboardFetch`, session cookie, CSRF rules
  unchanged), so permissions equal the signed-in person's. Results are compact JSON text.
- Tools (names use `vibecms_` + snake case):
  - `vibecms_site_get`, `vibecms_posts_list` (status, query, limit), `vibecms_post_get`
    (id or slug: Markdown, metadata, version number, preview URL).
  - `vibecms_post_create_draft` ({title, slug?, contentMarkdown, excerpt?, tags?}),
    `vibecms_post_update_draft` (requires `expectedVersionNumber`).
  - `vibecms_post_preview` (renders, returns warnings + SEO findings + preview URL),
    `vibecms_post_seo_check` (after 024), `vibecms_analytics_get` (range, postId?).
  - `vibecms_open` ({page: posts|post|settings|domain|analytics|connect|theme|media, postId?}):
    navigates the SPA so the person sees what the agent is talking about.
  - `vibecms_request_publish` ({postId, versionNumber}): opens the post with the Publish
    dialog showing that version. **The person clicks Publish.** There is no tool that publishes,
    schedules, archives or deletes.
- Descriptions say what is live vs draft, mirror MCP wording, and point to
  `posts.format_guide` content (the tool returns the guide in `vibecms_post_create_draft`'s
  description summary).

### 2. Origin trial token

`apps/dashboard/index.html` gets `<meta http-equiv="origin-trial" content="%VITE_WEBMCP_OT_TOKEN%">`
only when the env var is set at build time (Vite HTML env replacement; omit the tag
otherwise). The owner registers the token for the dashboard origin in Chrome's origin-trial
console. Self-host: optional, documented.

### 3. Blog pages (read-only, small)

Folded into a script tenant pages already load (no extra request for readers; CSP
`script-src 'self'` + asset origin from 022 phase 2). Registers only when
`document.modelContext` exists, so it costs nothing elsewhere. Custom domains and
`customer.com/blog` can't carry our origin-trial token, so until WebMCP ships in stable Chrome
these tools only appear for people who enabled it; that's fine, they're a small extra:
- `blog_search_posts` ({query}) → titles + URLs from the existing search index.
- `blog_get_post_markdown` ({url or slug}) → fetches the `.md` twin through `data-vc-base`.
No subscribe tool (consent must come from the person typing their email).

### 4. Discovery

`llms.txt` (marketing) and `auth.md` gain one paragraph: the dashboard exposes WebMCP tools
when signed in; publishing stays a human click. Docs page "Agents in your browser".

## Phases

1. Dashboard `webmcp.ts` + registration lifecycle + tools + tests with a fake `document.modelContext`.
2. Origin-trial meta wiring, blog read-only tools.
3. Docs + discovery text.

## Verification

- Unit: registration happens only with `document.modelContext`; abort on sign-out/site
  switch; each tool maps args → API call and returns JSON text; no tool can publish.
- Dev: Chrome Canary with the WebMCP flag or OT token on app.basedui.dev; list tools with the
  Model Context Tool Inspector extension; create a draft and open the publish dialog.

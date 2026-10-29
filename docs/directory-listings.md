# Directory listings

Copy, links and submission notes for listing vibecms in MCP and agent-skill
directories. Nothing here has been submitted. Items marked **[CHECK]** were not
confirmed from the directory's own docs on 2026-10-22; confirm them in the form
before you submit.

Repo files these listings depend on:

- `server.json`: Official MCP Registry entry for the hosted server.
- `.claude-plugin/marketplace.json`: makes this repo a Claude Code plugin
  marketplace named `vibecms`.
- `plugins/vibecms/`: the `vibecms` plugin. `.claude-plugin/plugin.json`
  declares the hosted MCP server; users sign in through OAuth.
- `skills/`: the only hand-edited copy of `vibecms-core`, `vibecms-writing`,
  `vibecms-seo`, `vibecms-import`, `vibecms-newsletter`, `vibecms-cross-post`
  and `vibecms-ship-to-draft` (what `npx skills add` and
  `/.well-known/agent-skills/` serve). The plugin's `plugins/vibecms/skills/`
  is a generated copy produced by `pnpm gen:agent-skills`; never edit it by
  hand.

Update the `server.json` version when the registry entry changes. Claude Code
only updates plugin users when the plugin `version` in
`plugins/vibecms/.claude-plugin/plugin.json` changes, so bump it whenever a
skill changes, even between product releases.

## Listing copy

- **Name:** vibecms
- **Tagline (78 chars):** A blog CMS your AI agents publish into over MCP, with you approving each post.
- **Description:** vibecms is a hosted blog CMS that AI agents write into
  over MCP. Agents draft Markdown posts, upload images and preview versions
  through a scoped sign-in connection or agent key. The vibecms skills tell
  them to ask for explicit approval before publishing a specific saved version.
  The code is open source (AGPL-3.0-or-later) and can be self-hosted on Cloudflare.
- **Short description (96 chars, the registry limit is 100):** A blog CMS that
  AI agents write into over MCP: Markdown drafts, versions, media, human
  approval.
- **Tags:** cms, blog, markdown, publishing, content-management, mcp,
  remote-mcp, ai-agents, agent-skills, cloudflare
- **Icon:** <https://vibecms.dev/icon-512.png> (512x512 PNG),
  <https://vibecms.dev/favicon.svg>

### Links

| | |
| --- | --- |
| Site | <https://vibecms.dev> |
| Docs | <https://vibecms.dev/docs> |
| Connect guide | <https://vibecms.dev/docs/getting-started/connect-an-agent> |
| Scopes and tools | <https://vibecms.dev/docs/agent-workflows/scopes-and-tools> |
| Repo | <https://github.com/moinulmoin/vibecms> |
| MCP URL | `https://app.vibecms.dev/mcp` (Streamable HTTP) |
| Server card | <https://app.vibecms.dev/.well-known/mcp/server-card.json> |
| Support | <https://vibecms.dev/legal/support> |
| Privacy / Terms | <https://vibecms.dev/legal/privacy>, <https://vibecms.dev/legal/terms> |

### How to connect

Point an OAuth-capable MCP client at the MCP URL, then choose **Connect** or
**Sign in** and approve a blog and access level before discovery or tool use.
Claude Code users can open `/mcp` to sign in. Existing agent-key users are
unchanged: create one under **Dashboard > Connect** (it starts with `vc_live_`
and is shown once) and send it as a bearer token on every MCP request:

```json
{
  "mcpServers": {
    "vibecms": {
      "type": "http",
      "url": "https://app.vibecms.dev/mcp",
      "headers": { "Authorization": "Bearer vc_live_..." }
    }
  }
}
```

Server behavior that directory scanners will see:

- `initialize`, `tools/list`, modern `server/discover`, legacy
  `notifications/initialized` and tool calls require authentication up front.
  Without a bearer, valid requests return HTTP `401`, JSON-RPC `-32001`, and a
  `WWW-Authenticate: Bearer` resource-metadata challenge without `invalid_token`.
  Invalid or expired bearers retain `401` with `error="invalid_token"`.
- Anonymous Smithery, MCP Registry and Anthropic scanners see that challenge,
  not an enumerable tool list. Where supported, use OAuth or supply a dedicated
  least-privilege test key for a dedicated test blog; never a production key.
  Confirm each directory's authenticated scan flow before submission **[CHECK]**.
  If it only supports anonymous enumeration, tool scanning is incompatible.
- Authenticated `tools/list` is scope-filtered with private caching.
  `server/discover` also requires authentication; its successful response keeps
  `cacheScope: "public"` because it is identical across principals, not because
  anonymous requests are allowed.
- OAuth metadata at `/.well-known/oauth-protected-resource/mcp`,
  `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, trusted CIMD/public-client DCR,
  HTTP agent skill files and `/.well-known/mcp/server-card.json` remain public.
  The static server card is not anonymous live MCP tool enumeration.
- Access levels: Write drafts, Write and publish, Manage. Choose the smallest
  level needed for the directory's tests; a dedicated Write drafts key is
  suitable for Glama's authenticated health check.

## Per-directory notes

### Official MCP Registry

- **Submit:** `mcp-publisher publish` from the repo root, after logging in.
  Docs: <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx>,
  remote servers: <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx>.
- **Install the CLI:** `brew install mcp-publisher`, or download the release
  binary from <https://github.com/modelcontextprotocol/registry/releases/latest>.
- **Entry:** `server.json` (schema `2025-12-11`), name `dev.vibecms/vibecms`,
  one `streamable-http` remote using OAuth discovery, without a static required
  `Authorization` header in the listing. Clients authenticate through OAuth;
  the absence of a listed header does not permit anonymous MCP discovery.
  Registry scanners receive `401`; use OAuth or a dedicated least-privilege
  test key where supported, and confirm authenticated scanning **[CHECK]**.
  Remote-only, so no package ownership check.
  Run `mcp-publisher validate` before publishing.
- **Namespace proof (DNS, preferred).** The registry checks a TXT record on the
  **apex** `vibecms.dev`, not a subdomain. On macOS, use OpenSSL 3 because the
  system LibreSSL lacks Ed25519. Generate the key outside the repo (`.pem`
  files are not gitignored) and keep it private:

  ```sh
  mkdir -p ~/.config/mcp-registry && cd ~/.config/mcp-registry
  OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
  $OPENSSL genpkey -algorithm Ed25519 -out vibecms-dev.pem
  PUBLIC_KEY="$($OPENSSL pkey -in vibecms-dev.pem -pubout -outform DER | tail -c 32 | base64)"
  echo "vibecms.dev. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
  ```

  Add that record in Cloudflare DNS for the `vibecms.dev` zone: type `TXT`,
  name `@`, content `v=MCPv1; k=ed25519; p=<PUBLIC_KEY>`. The existing SPF TXT
  record stays. Then:

  ```sh
  PRIVATE_KEY="$($OPENSSL pkey -in ~/.config/mcp-registry/vibecms-dev.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
  mcp-publisher login dns --domain vibecms.dev --private-key "${PRIVATE_KEY}"
  mcp-publisher publish
  ```

  The same `dev.vibecms` namespace also lets Glama verify ownership through
  the registry.
- **Fallback (GitHub):** change `name` in `server.json` to
  `io.github.moinulmoin/vibecms`, run `mcp-publisher login github`, then
  `mcp-publisher publish`. Pick one namespace before the first publish: a
  remote URL can belong to only one server name.
- **Verify:** <https://registry.modelcontextprotocol.io/v0/servers?search=vibecms>
- **Founder needs:** the TXT record (or a GitHub device-code login), and one
  `publish` run.

### Claude Code plugin marketplace (self-hosted, this repo)

- **Install (after this branch is on `main`):**
  `claude plugin marketplace add moinulmoin/vibecms` then
  `claude plugin install vibecms@vibecms` (or `/plugin marketplace add
  moinulmoin/vibecms` and `/plugin install vibecms@vibecms` in a session).
- **Docs:** <https://code.claude.com/docs/en/plugin-marketplaces>,
  <https://code.claude.com/docs/en/plugins/manifest-reference>.
- **What it installs:** skills `vibecms:vibecms-core`,
  `vibecms:vibecms-writing`, `vibecms:vibecms-seo`, `vibecms:vibecms-import`,
  `vibecms:vibecms-newsletter`, `vibecms:vibecms-cross-post` and
  `vibecms:vibecms-ship-to-draft`, and the MCP server `vibecms`. Users sign in
  and approve access through OAuth rather than entering a key in the plugin.
- **Check:** run `claude plugin validate .` and
  `claude plugin validate ./plugins/vibecms` before publishing.
- **Founder needs:** merge to `main`. Nothing to submit.

### Anthropic's plugin directory (claude.ai, Cowork, Claude Code)

- **Submit:** developer portal <https://claude.ai/directory/manage> > **Submit
  new** > **Plugin bundle**. Repository `moinulmoin/vibecms`, plugin path
  `plugins/vibecms`, branch `main`. Docs:
  <https://claude.com/docs/plugins/submit> and the checklist
  <https://claude.com/docs/plugins/pre-submission-checklist>.
- **Plugin contents:** `.claude-plugin/plugin.json` has `name`, `version`,
  `description`, `author`, `license`, `icon` (`assets/icon.png`, 512 px) and
  the four listing URLs. The README explains what the plugin sends and where.
  The MCP URL uses HTTPS, and authentication uses OAuth.
- **Requirements:** a paid claude.ai plan (Pro or Max from a personal account;
  Owner on Team or Enterprise); GitHub connected to claude.ai with push access
  to the repo; the repo public before the listing goes live; answers to the
  data-handling and compliance steps; a contact email.
- **Connector pairing:** also submit the MCP server as an **MCP connector**:
  <https://claude.com/docs/connectors/building/submission>. Every tool needs a
  human-readable `title` and the applicable annotation: `readOnlyHint: true`
  for read-only tools, or `destructiveHint: true` for tools that modify or
  delete data. The portal syncs the tools and flags missing titles or
  annotations; fix them on the server before submitting. An anonymous portal
  scan receives `401`, not a tool inventory. Use its OAuth flow or a dedicated
  least-privilege test key where supported; confirm authenticated tool sync
  **[CHECK]**. See <https://claude.com/docs/connectors/building/review-criteria>.
- **Reviewer access:** provide credentials for a fully populated test account
  in the connector portal's **Test & launch** step, along with every link and
  step needed to sign in, connect, and run the tools. Use a dedicated test blog
  populated with representative posts and media, and grant only the access
  needed for the requested review scenarios, including publishing and
  management operations when those are being reviewed. The
  portal says only reviewers see the credentials. Exercise every tool in MCP
  Inspector and as a custom connector in Claude before submitting, and confirm
  the testing in the portal.
- **Founder needs:** a paid claude.ai plan and GitHub connected on claude.ai.
  Submit the plugin and connector only after production sign-in works, then
  **Publish** once the version passes.

### Smithery

- **Submit:** <https://smithery.ai/new>, enter `https://app.vibecms.dev/mcp`
  (URL publishing, "bring your own hosting"). Docs:
  <https://smithery.ai/docs/build/publish>.
- **Requirements:** Streamable HTTP and "OAuth support (if auth required)".
  vibecms supports OAuth and challenges anonymous discovery with `401`.
  Use Smithery's OAuth flow or a dedicated least-privilege test key where
  supported; anonymous `tools/list` enumeration is not available. Confirm the
  current authenticated scan setup in the publish flow **[CHECK]**.
- **Founder needs:** a Smithery account (sign-in method **[CHECK]**) and the
  publish flow; optionally the verification checklist under the server's
  **Settings > Verification**.

### Glama

- **Connector (remote server):** Glama imports connectors from the Official
  MCP Registry, so publishing `dev.vibecms/vibecms` should create
  `https://glama.ai/mcp/connectors/dev.vibecms/vibecms` **[CHECK after
  publish]**. Manual path: <https://glama.ai/mcp/connectors> > **Add MCP
  Server** > **Connector** (name, short description, HTTPS URL, optional test
  credential).
- **Claim:** **Claim ownership** on the connector page, then verify
  `vibecms.dev` with a TXT record at `_glama-claim.vibecms.dev` (value shown by
  Glama) or a `https://vibecms.dev/.well-known/glama.json` file. Set the test
  profile to **API Key** with a Write drafts key from a test site so the badge
  reads `auth:api_key` and health checks hit the authenticated path.
- **Server (GitHub repo):** <https://glama.ai/mcp/servers> > **Add MCP
  Server**, repository `https://github.com/moinulmoin/vibecms`. Optional
  `glama.json` in the repo to set name and category (not added).
- **Founder needs:** a Glama account, the claim TXT record or file, and a test
  key (a throwaway Write drafts key, not a production author key).

### PulseMCP

- **Submit:** none right now. <https://www.pulsemcp.com/submit> says
  submissions are paused (updated 2026-09-03) and that servers published to
  the Official MCP Registry are picked up automatically when they reopen.
- **Founder needs:** nothing beyond the registry publish.

### mcp.so

- **Submit:** <https://mcp.so/submit?type=remote-server> (tab **Remote
  Server**). Fields: Repository URL (required), Name. Free submissions are
  reviewed; a $39 one-time paid option skips review.
- **Values:** Repository `https://github.com/moinulmoin/vibecms`, Name
  `vibecms`. Whether the form also takes the MCP URL and description **[CHECK]**.
- **Founder needs:** an mcp.so sign-in **[CHECK]** and the form submit. Paid
  option not recommended.

### awesome-remote-mcp-servers (GitHub PR, recommended)

`punkpeye/awesome-mcp-servers` says remote-only servers belong in
<https://github.com/punkpeye/awesome-remote-mcp-servers>. Its CONTRIBUTING
requires: a public endpoint that answers `initialize` (CI checks it), public
sign-up, a Glama connector badge (so publish to the registry and get the
Glama connector first), alphabetical order, and that the PR author has
starred the repo.

vibecms now returns a sign-in `401` for anonymous `initialize`. Confirm that
the directory's CI accepts an OAuth challenge or supports authenticated
checks before opening the PR **[CHECK]**; a check that requires anonymous
successful initialization is incompatible with this policy. Do not bypass
authentication to satisfy a directory scan.

Add under **📝 Content Management**, between Storyblok and Webflow:

```markdown
- [vibecms](https://vibecms.dev) `https://app.vibecms.dev/mcp`
  [![vibecms MCP connector](https://glama.ai/mcp/connectors/dev.vibecms/vibecms/badges/score.svg)](https://glama.ai/mcp/connectors/dev.vibecms/vibecms)
  🔑 - Draft, preview and publish Markdown blog posts and images on a hosted blog, with scoped sign-in or agent keys.
```

- **Founder needs:** star the repo, fork, open the PR from the founder's
  GitHub account.

### awesome-mcp-servers (GitHub PR, optional)

<https://github.com/punkpeye/awesome-mcp-servers>. Its scope is servers with a
public GitHub repo that you install and run yourself. vibecms qualifies only
through self-hosting on Cloudflare, so the fit is weaker than the remote list
**[CHECK]**. Format: `[owner/repo](link)`, optional Glama badge, language and
scope icons, ` - `, description. Add under **🏢 Workplace & Productivity**,
after `mnoomnoo/resume-mcp-server` (category choice **[CHECK]**):

```markdown
- [moinulmoin/vibecms](https://github.com/moinulmoin/vibecms) 📇 ☁️ - Blog CMS that AI agents write into over MCP: Markdown drafts, versions, images and approval before publish. Hosted or self-hosted on Cloudflare.
```

- **Founder needs:** fork and open the PR.

### Cursor directory

- **Submit:** <https://cursor.directory/plugins/new> ("Submit a Plugin";
  `/mcp/new` shows the same form). It can auto-detect from a GitHub repo that
  follows the Open Plugins standard (root `plugin.json` plus `mcp.json`); this
  repo uses the Claude Code layout instead, so use **create manually**
  **[CHECK fields]**.
- **Values:** name `vibecms`, the description above, homepage
  `https://vibecms.dev`, source `https://github.com/moinulmoin/vibecms`, MCP
  config:

  ```json
  { "vibecms": { "url": "https://app.vibecms.dev/mcp", "headers": { "Authorization": "Bearer vc_live_..." } } }
  ```

- **Founder needs:** a cursor.directory sign-in **[CHECK]** and the form
  submit. The site rate-limited automated requests, so the form was not read
  directly.

### skills.sh

- **Submit:** none. Skills are indexed automatically from anonymous install
  telemetry when someone runs
  `npx skills add https://vibecms.dev --skill '*'`
  (<https://skills.sh/docs/faq>). The CLI discovers the hosted skills through
  `https://vibecms.dev/.well-known/agent-skills/`. Run
  `npx skills update` to stay current.
- **Status:** <https://www.skills.sh/moinulmoin/vibecms/vibecms-core> renders,
  but the site renders a page for any slug, so whether it is indexed is
  **[CHECK]**.
- **Founder needs:** nothing; installs drive the ranking.

### Other directories worth a look

The r/mcp thread "Anyone knows a list of MCP directories?" could not be read
(Reddit blocks unauthenticated requests). Directories named in other current
round-ups that this list does not cover yet, all **[CHECK]**:

- MCP Market: <https://mcpmarket.com/submit>
- mcpservers.org (web version of an awesome list): <https://mcpservers.org/submit>
- LobeHub MCP: <https://lobehub.com/mcp>
- GitHub MCP Registry: <https://github.com/mcp> (curated; whether it pulls
  from the Official MCP Registry is unconfirmed)
- jaw9c/awesome-remote-mcp-servers: <https://github.com/jaw9c/awesome-remote-mcp-servers>
- HOL Plugins: <https://hol.org/plugins>

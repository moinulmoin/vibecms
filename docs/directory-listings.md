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
  declares the hosted MCP server and asks for the agent key.
- `skills/`: the only hand-edited copy of the `vibecms-core`,
  `vibecms-writing` and `vibecms-seo` skills (what `npx skills add` and
  `/.well-known/agent-skills/` serve). The plugin's `plugins/vibecms/skills/`
  is a generated copy produced by `pnpm gen:agent-skills`; never edit it by
  hand.

When the product changes, keep `version` in `server.json` in step with the
root `package.json`. Claude Code only updates plugin users when the plugin
`version` in `plugins/vibecms/.claude-plugin/plugin.json` changes, so bump it
whenever a skill changes, even between product releases.

## Listing copy

- **Name:** vibecms
- **Tagline (78 chars):** A blog CMS your AI agents publish into over MCP, with you approving each post.
- **Description:** vibecms is a hosted blog CMS that AI agents write into
  over MCP. Agents draft Markdown posts, upload images and preview versions
  with a scoped agent key, and the vibecms skills make them stop for your
  explicit approval before they publish a specific saved version. The code is
  open source (AGPL-3.0-or-later) and can be self-hosted on Cloudflare.
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

Sign in at <https://app.vibecms.dev>, open **Dashboard > Connect**, create an
agent key (it starts with `vc_live_` and is shown once), then point the client
at the MCP URL with the key as a bearer token. There is no OAuth.

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

- `initialize` and `tools/list` answer without a key, so scanners can index
  the tools. `tools/list` with an invalid key returns `401`.
- `tools/call` without a valid key returns HTTP `401` (JSON-RPC error
  `-32001`). The response has no `WWW-Authenticate` header and the server
  publishes no OAuth metadata, so OAuth-first directories will treat it as an
  API-key server.
- Key levels: Write drafts, Write and publish, Manage. A Write drafts key is
  the right one for any test credential a directory asks for.

## Per-directory notes

### Official MCP Registry

- **Submit:** `mcp-publisher publish` from the repo root, after logging in.
  Docs: <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx>,
  remote servers: <https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx>.
- **Install the CLI:** `brew install mcp-publisher`, or download the release
  binary from <https://github.com/modelcontextprotocol/registry/releases/latest>.
- **Entry:** `server.json` (schema `2025-12-11`), name `dev.vibecms/vibecms`,
  one `streamable-http` remote with a required secret `Authorization` header
  (`Bearer {vibecms_api_key}`). Remote-only, so no package ownership check.
  `mcp-publisher validate` (v1.8.1) passes.
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
  `vibecms:vibecms-writing` and `vibecms:vibecms-seo`, and the MCP server
  `vibecms`. The key is a
  `userConfig` value (`sensitive: true`): Claude Code prompts for it when the
  plugin is enabled, masks it, and stores it in the system credential store.
  The header is `Bearer ${user_config.api_key}`; no key is in the repo.
- **Check:** `claude plugin validate .` and
  `claude plugin validate ./plugins/vibecms` both pass with no findings.
- **Founder needs:** merge to `main`. Nothing to submit.

### Anthropic's plugin directory (claude.ai, Cowork, Claude Code)

- **Submit:** developer portal <https://claude.ai/directory/manage> > **Submit
  new** > **Plugin bundle**. Repository `moinulmoin/vibecms`, plugin path
  `plugins/vibecms`, branch `main`. Docs:
  <https://claude.com/docs/plugins/submit> and the checklist
  <https://claude.com/docs/plugins/pre-submission-checklist>.
- **How the plugin meets the checklist:** the plugin folder holds
  `.claude-plugin/plugin.json` with `name`, `version`, `description`, `author`,
  `license`, `icon` (`assets/icon.png`, 512 px) and the four listing URLs; a
  README over 40 words that says what the plugin sends and where; regular
  files only (no symlinks); about six files; an `https://` MCP URL; the key
  asked through `userConfig` with `sensitive: true` instead of an environment
  variable (reading a credential from the environment is held for review).
- **Requirements:** a paid claude.ai plan (Pro or Max from a personal account;
  Owner on Team or Enterprise); GitHub connected to claude.ai with push access
  to the repo; the repo public before the listing goes live; answers to the
  data-handling and compliance steps; a contact email.
- **Connector pairing:** the docs ask you to also submit the MCP server as an
  **MCP connector** (<https://claude.com/docs/connectors/building/submission>).
  Connectors are expected to use OAuth 2.0 for account data; a "custom
  connection where users supply their own credentials" needs coordination
  with the review team. vibecms has bearer keys only, so the connector
  submission is likely blocked until OAuth exists **[CHECK]**.
- **Founder needs:** a paid claude.ai plan, GitHub connected on claude.ai, the
  portal submission, then **Publish** once the version passes.

### Smithery

- **Submit:** <https://smithery.ai/new>, enter `https://app.vibecms.dev/mcp`
  (URL publishing, "bring your own hosting"). Docs:
  <https://smithery.ai/docs/build/publish>.
- **Requirements:** Streamable HTTP (met) and "OAuth support (if auth
  required)". Scanning works because `tools/list` is open. For per-user keys,
  the CLI path takes a config schema:
  `smithery mcp publish "https://app.vibecms.dev/mcp" -n @moinulmoin/vibecms --config-schema '<schema>'`
  with a property read from a header (`x-from`) and forwarded as
  `Authorization` (`x-to`). Smithery forwards the value as-is, so users would
  have to enter `Bearer vc_live_...` **[CHECK]**.
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

Add under **📝 Content Management**, between Storyblok and Webflow:

```markdown
- [vibecms](https://vibecms.dev) `https://app.vibecms.dev/mcp`
  [![vibecms MCP connector](https://glama.ai/mcp/connectors/dev.vibecms/vibecms/badges/score.svg)](https://glama.ai/mcp/connectors/dev.vibecms/vibecms)
  🔑 - Draft, preview and publish Markdown blog posts and images on a hosted blog, with scoped agent keys.
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
  `npx skills add moinulmoin/vibecms --skill '*'`
  (<https://skills.sh/docs/faq>). The CLI discovers the skills in the
  root `skills/` directory.
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

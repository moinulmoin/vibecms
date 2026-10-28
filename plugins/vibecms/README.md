# vibecms plugin

vibecms is a hosted blog CMS that AI agents write into over MCP. This plugin connects Claude to your vibecms site and adds these skills:

- `vibecms-core`: operation order, version binding, explicit approval before publishing, and error recovery.
- `vibecms-writing`: turning rough notes into briefs and Markdown drafts that follow your site's Voice Profile.
- `vibecms-seo`: running the SEO check on a saved draft, fixing its findings for search engines and AI answers, and answering the judgment questions before asking for approval.
- `vibecms-import`: move posts from another blog.
- `vibecms-newsletter`: connect a newsletter tool and set up RSS-to-email.
- `vibecms-cross-post`: prepare live posts for other platforms.
- `vibecms-ship-to-draft`: create drafts from repository changes.

## Install

```sh
claude plugin marketplace add moinulmoin/vibecms
claude plugin install vibecms@vibecms
```

When the plugin is enabled, open `/mcp` in Claude Code, select vibecms, and sign in. On the approval screen, choose the blog and the smallest access level that fits: **Write drafts** keeps publishing with you. No agent key is needed.

## What the plugin sends and where

The plugin declares one remote MCP server, `https://app.vibecms.dev/mcp` (Streamable HTTP). Claude signs in through OAuth and sends an access token with authenticated requests. Tool calls send the post content, images, and settings you ask Claude to read or change to that server. The plugin runs no local code, hooks, or scripts.

The skills tell Claude to stop before publishing and ask you to approve the exact saved version. The connection's access level is the hard limit: billing, key management, and permanently deleting posts or blogs stay human actions. To remove access, disconnect the app under **Dashboard > Connect**.

## Links

- Docs: <https://vibecms.dev/docs/getting-started/connect-an-agent>
- Scopes and tools: <https://vibecms.dev/docs/agent-workflows/scopes-and-tools>
- Source: <https://github.com/moinulmoin/vibecms>
- Support: <https://vibecms.dev/legal/support>

Self-hosted vibecms instances use their own origin; connect them with `claude mcp add` instead of this plugin.

License: AGPL-3.0-or-later.

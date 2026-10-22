# vibecms plugin

vibecms is a hosted blog CMS that AI agents write into over MCP. This plugin connects Claude to your vibecms site and adds two skills:

- `vibecms-core`: operation order, version binding, explicit approval before publishing, and error recovery.
- `vibecms-writing`: turning rough notes into briefs and Markdown drafts that follow your site's Voice Profile.

## Install

```sh
claude plugin marketplace add moinulmoin/vibecms
claude plugin install vibecms@vibecms
```

When the plugin is enabled, Claude asks for a vibecms agent key. Create one under **Dashboard > Connect** at [app.vibecms.dev](https://app.vibecms.dev). Choose the smallest level that fits: **Write drafts** keeps publishing with you. The key is masked and kept in secure storage.

## What the plugin sends and where

The plugin declares one remote MCP server, `https://app.vibecms.dev/mcp` (Streamable HTTP). Every request carries your agent key as `Authorization: Bearer <key>`. Tool calls send the post content, images, and settings you ask Claude to read or change to that server and nowhere else. The plugin runs no local code, hooks, or scripts.

The skills tell Claude to stop before publishing and ask you to approve the exact saved version. The key's level is the hard limit: billing, key management, and deleting posts or blogs stay human actions.

## Links

- Docs: <https://vibecms.dev/docs/getting-started/connect-an-agent>
- Scopes and tools: <https://vibecms.dev/docs/agent-workflows/scopes-and-tools>
- Source: <https://github.com/moinulmoin/vibecms>
- Support: <https://vibecms.dev/legal/support>

Self-hosted vibecms instances use their own origin; connect them with `claude mcp add` instead of this plugin.

License: AGPL-3.0-or-later.

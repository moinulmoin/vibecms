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

### Other services, only when you ask

Three skills can reach services other than vibecms, and only for a task you request:

- `vibecms-cross-post` sends a published post's public text and URL to DEV (`https://dev.to/api`) or Hashnode (`https://gql-beta.hashnode.com`) as a draft, using your own `DEV_API_KEY` or `HASHNODE_PAT` from your environment. For Medium it gives you Medium's import link and sends nothing.
- `vibecms-import` reads your existing posts from Ghost or WordPress through their read APIs (with Ghost's read-only Content API key, if you use that route). It sends nothing to them.
- `vibecms-ship-to-draft` writes a GitHub Actions workflow into your repository. That workflow runs in GitHub, not on your machine, and sends your repository changes to Claude (with your `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`) and the resulting draft to `https://app.vibecms.dev/mcp` with your own vibecms agent key, stored as the `VIBECMS_KEY` repository secret. That key is issued by vibecms and only goes to vibecms.

`vibecms-newsletter` saves your newsletter tool's signup form address in your vibecms settings; readers' signups then go to that tool. Keys stay in your environment or repository secrets and are never written to files or chat.

## Links

- Docs: <https://vibecms.dev/docs/getting-started/connect-an-agent>
- Scopes and tools: <https://vibecms.dev/docs/agent-workflows/scopes-and-tools>
- Source: <https://github.com/moinulmoin/vibecms>
- Support: <https://vibecms.dev/legal/support>

Self-hosted vibecms instances use their own origin; connect them with `claude mcp add` instead of this plugin.

License: AGPL-3.0-or-later.

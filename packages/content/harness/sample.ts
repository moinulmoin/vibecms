export const SAMPLE_POST = `Most "AI blogging" tools want to write *for* you. We wanted the opposite: an agent that drafts, a human who decides, and a record of every change in between.[^1]

## The shape of the problem

Agents are great at first drafts and terrible at knowing when something is ready. So the contract is simple: agents get a **scoped token** that can draft, and publishing stays a deliberate act.

:::tip[Start small]
Give your first agent the \`draft\` scope only. Promote it to \`publish\` once you trust its output.
:::

### Connecting over MCP

\`\`\`ts title="agent.ts" {3}
import { connect } from "@vibecms/mcp";

const cms = await connect({ token: process.env.VIBECMS_TOKEN });
await cms.posts.create({ title: "Hello", contentMarkdown: "# Hi" }); // [!code ++]
\`\`\`

\`\`\`bash
pnpm dlx vibecms login
\`\`\`

## What the human sees

Every agent edit lands as a new version. You review the diff, then publish that exact version.

| Action | Agent | Human |
| --- | --- | --- |
| Draft | Yes | Yes |
| Publish | With scope | Yes |
| Restore | No | Yes |

> Good tools make the safe path the easy path.

> [!WARNING]
> Publishing pins the live page to one version. Later edits stay private until you publish again.

:::details[Why not auto-publish?]
Because a blog is a promise to readers. Auto-publishing turns every hallucination into a public retraction.
:::

### Keyboard-first review

Press <kbd>Cmd</kbd> + <kbd>S</kbd> to save, and use the version list to jump between drafts.

- Review the diff
- Check the preview at phone width
- [x] Publish the exact version you approved

## Wrapping up

The result feels less like a CMS and more like a code review for prose.

[^1]: Versions are immutable; publishing moves a pointer.
`;

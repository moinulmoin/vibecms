/** Kitchen sink for the v4 Markdown blocks (`/blocks.html` in the harness). */
export const BLOCKS_SAMPLE = `[[toc]]

## Math {#math}

The price is $5 and $10 stays literal. Inline math: $$e^{i\\pi} + 1 = 0$$.

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`math
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
\`\`\`

## Diagram

\`\`\`mermaid
flowchart LR
  Agent -->|drafts| Draft
  Draft --> Review{Human review}
  Review -->|approve| Live
  Review -->|edit| Draft
\`\`\`

## Headings with markers {#markers}

### Hidden from the outline [!toc]

##### A small h5 heading

## Code

Call \`fetch("/api"){:ts}\` or \`const x = 1{:js}\` inline.

\`\`\`ts title="client.ts" wrap
// [!code word:cms]
const cms = await connect({ token: process.env.VIBECMS_TOKEN, retries: 3, timeoutMs: 10_000, userAgent: "vibecms-agent/1.0 (+https://example.com)" });
// [!code highlight:2]
await cms.posts.create({ title: "Hello" });
await cms.posts.preview({ id: "p1" });
await cms.posts.publish({ id: "p1" });
\`\`\`

## Steps

:::steps
1. Install the CLI.
2. Log in with \`vibecms login\`.
3. Ask your agent to draft a post.
:::

:::steps
### Connect

Add the MCP server to your agent.

### Draft

Let it write.

### Publish

You approve the exact version.
:::

## Tabs

::::tabs
:::tab[macOS]
Press <kbd>Cmd</kbd> + <kbd>K</kbd>.
:::
:::tab[Windows]
Press <kbd>Ctrl</kbd> + <kbd>K</kbd>.
:::
::::

:::code-group
\`\`\`ts title="config.ts"
export default { preset: "minimal" }
\`\`\`
\`\`\`js [config.js]
module.exports = { preset: "minimal" }
\`\`\`
:::

\`\`\`package-install
npm i -D @vibecms/cli
\`\`\`

## Images

![A plotted curve](https://placehold.co/960x400/png?text=captioned "The title becomes the caption")

![Light logo](https://placehold.co/480x120/eee/111/png?text=light+mode#gh-light-mode-only)
![Dark logo](https://placehold.co/480x120/111/eee/png?text=dark+mode#gh-dark-mode-only)

## Tables

| Action | Agent | Human | Notes |
| --- | --- | --- | --- |
| Draft | Yes | Yes | Every save is a version you can restore later on |
| Publish | With scope | Yes | Pins the live page to one version |

|   |   |
| - | - |
| headerless | table |
`;

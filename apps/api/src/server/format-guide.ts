import type { FormatGuideDto } from "@vc/api-contract";
import { THEME_PRESETS, type PresetId } from "@vc/config";
import { RENDERER_VERSION } from "@vc/content/constants";

/** Bumped when the v1 syntax vocabulary changes. */
export const GUIDE_VERSION = "4";

export { RENDERER_VERSION };

/**
 * Agent-facing notes for the presentation field. Returned as part of
 * presentationOptions so agents understand how to declare layout intent.
 */
const PRESENTATION_NOTES =
  "Declare layout intent via the typed `presentation` field on posts.create or posts.update - NOT in front-matter or body text. " +
  "Supported fields: `layout` (`standard`, `essay` for longform with a lead paragraph, or `feature` for a full-width cover above the title) and `toc` (boolean; the page-level outline appears once a post has 3+ H2/H3 headings). " +
  "Do not combine `presentation.toc: true` with an inline `[[toc]]` marker in the body - choose one; " +
  "`presentation.toc` is preferred when the preset supports it and removes the need for a manual [[toc]] marker.";

const V1_EXAMPLES = `
=== Callouts (GOOD) ===
> [!NOTE]
> This is a note rendered as a callout card.

> [!TIP]
> Press Ctrl+K to open the command palette.

> [!IMPORTANT]
> Save your work before proceeding.

> [!WARNING]
> This action changes your configuration.

> [!CAUTION]
> Destructive - cannot be undone.

=== Callouts with a custom title (GOOD) ===
:::tip[Start small]
Give your first agent the draft scope only.
:::

:::warning
Titles are optional; the default is the kind's name.
:::
// Kinds: note, tip, important, warning, caution (aliases: info, success, danger, error).

=== Collapsible section (GOOD) ===
:::details[Why not auto-publish?]
Hidden until the reader expands it.
:::

=== Callouts (BAD - non-standard type renders as a plain blockquote) ===
> [!WARN]    <- typo; use [!WARNING]
> [!info]    <- lowercase; use [!NOTE]

=== Table of contents - page-level (GOOD when preset supportsToc) ===
// Set presentation.toc: true on posts.create / posts.update.
// The runtime inserts a TOC block above the article body; no inline marker needed.

=== Table of contents - inline marker (GOOD when page-level TOC is not active) ===
[[toc]]

## Introduction
## Setup
### Advanced options

=== Table of contents (BAD - omitting both presentation.toc and [[toc]] produces no TOC) ===
<!-- No [[toc]] marker and no presentation.toc: true -> no table of contents is generated. -->

=== Captioned image (GOOD - image line + emphasis line, no blank line between) ===
![A golden retriever on a sunny hillside](/assets/dog.jpg)
*A golden retriever enjoying the afternoon sun.*

=== Captioned image (BAD - blank line separates image from emphasis; becomes a paragraph) ===
![A dog on a hillside](/assets/dog.jpg)

*This becomes a paragraph, not a caption.*

=== Captioned image (BAD - missing alt text is flagged as a warning) ===
![](/assets/dog.jpg)
*Caption with no alt text.*

=== Fenced code (GOOD - always include a language label) ===
\`\`\`typescript
const greet = (name: string) => \`Hello, \${name}!\`;
\`\`\`

\`\`\`bash
pnpm install && pnpm dev
\`\`\`

=== Fenced code with a file title, highlighted lines, and line numbers (GOOD) ===
\`\`\`ts title="src/publish.ts" {2} showLineNumbers
export async function publish(id: string) {
  const tip = await cms.posts.get(id)
  return cms.posts.publish(id, { expectedVersionNumber: tip.versionNumber })
}
\`\`\`

=== Diff and line markers (GOOD) ===
\`\`\`diff
- const scope = "publish"
+ const scope = "draft"
\`\`\`

\`\`\`ts
const a = 1 // [!code --]
const b = 2 // [!code ++]
const c = 3 // [!code highlight]
\`\`\`
// Markers are stripped from the rendered and copied code.

=== Fenced code (BAD - missing language label gives weaker rendering) ===
\`\`\`
const x = 1;
\`\`\`

=== Standard GFM ===
| Feature        | v1  |
|----------------|-----|
| Tables         | yes |
| Lists          | yes |
| Bold / italic  | yes |
| Links          | yes |

- Unordered list item
1. Ordered list item

[Link text](https://example.com)

**Bold** and *italic* and ~~strikethrough~~

- [x] Task lists
- [ ] Unchecked task

Footnotes add a reference.[^1]

[^1]: And the note renders at the end of the post.

=== Embeds (GOOD - a bare YouTube link on its own line becomes a video card) ===
https://www.youtube.com/watch?v=dQw4w9WgXcQ

=== Math (GOOD - $$ blocks or a \`\`\`math fence; a single $ stays literal, so prices are safe) ===
The energy is $$E = mc^2$$ and the widget costs $5.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
// TeX only (KaTeX). No custom macros (\\def, \\newcommand). Invalid TeX is shown as its source instead of a formula.

=== Diagrams (GOOD - a \`\`\`mermaid fence, max 5,000 characters) ===
\`\`\`mermaid
flowchart LR
  Agent -->|drafts| Draft --> Review{Human review} -->|approve| Live
\`\`\`
// Readers without JavaScript (and RSS) see the source; the page draws the diagram.

=== Heading ids and outline markers (GOOD) ===
## Install {#install}
## Aside [!toc]
// {#id} sets a stable anchor (#h-install): lowercase letters, digits, hyphens.
// [!toc] keeps a heading out of the table of contents.

=== Steps (GOOD - a numbered list, or one heading per step) ===
:::steps
1. Install the CLI.
2. Run \`vibecms login\`.
3. Ask your agent for a draft.
:::

=== Tabs (GOOD - outer fence has one more colon than the tabs inside) ===
::::tabs
:::tab[macOS]
Press <kbd>Cmd</kbd> + <kbd>K</kbd>.
:::
:::tab[Windows]
Press <kbd>Ctrl</kbd> + <kbd>K</kbd>.
:::
::::
// Readers' tab choice syncs across the page by label; without JavaScript every tab shows, labelled.

=== Code group (GOOD - fenced code only; the title or [label] names each tab) ===
:::code-group
\`\`\`ts title="vibecms.config.ts"
export default { preset: "minimal" }
\`\`\`
\`\`\`js [vibecms.config.js]
module.exports = { preset: "minimal" }
\`\`\`
:::

=== Package install (GOOD - write npm once, readers get npm / pnpm / yarn / bun tabs) ===
\`\`\`package-install
npm i -D @vibecms/cli
\`\`\`

=== Code extras (GOOD) ===
\`\`\`ts title="client.ts" wrap
// [!code word:cms]
const cms = await connect() // [!code highlight:2]
await cms.posts.create({ title: "Hello" })
\`\`\`
Inline code can be highlighted too: \`fetch(url){:ts}\`.
// [!code word:x] marks every "x" below it; [!code highlight:N] / [!code ++:N] cover N lines;
// a marker alone on its line applies to the next line. \`wrap\` soft-wraps long lines.

=== Images: caption from the title, light/dark variants (GOOD) ===
![Deploy flow](/assets/flow.png "How a draft becomes a live post")

![Logo](/assets/logo-light.png#gh-light-mode-only)
![Logo](/assets/logo-dark.png#gh-dark-mode-only)

=== Headerless table (GOOD - an empty header row is dropped) ===
|   |   |
|---|---|
| Plan | Free |

=== Inline HTML (GitHub-safe tags only) ===
Press <kbd>Cmd</kbd> + <kbd>K</kbd>. H<sub>2</sub>O and x<sup>2</sup> work.
<!-- Scripts, iframes, styles, and unknown tags are removed and reported as warnings by posts.preview. -->
`.trim();

/** Structured vocabulary, one entry per syntax, for agents that don't parse the prose guide. */
const SYNTAX: FormatGuideDto["syntax"] = [
  { id: "callout", summary: "GitHub alert callout", example: "> [!NOTE]\n> Text." },
  { id: "callout-directive", summary: "Callout with a custom title", example: ":::tip[Title]\nText.\n:::" },
  { id: "details", summary: "Collapsible section", example: ":::details[Summary]\nHidden text.\n:::" },
  { id: "toc", summary: "Inline table of contents", example: "[[toc]]" },
  { id: "heading-id", summary: "Stable heading anchor (h- prefix, [a-z0-9-])", example: "## Install {#install}" },
  { id: "heading-toc-hide", summary: "Keep a heading out of the table of contents", example: "## Aside [!toc]" },
  { id: "image-caption", summary: "Captioned image (title or an emphasis line)", example: '![Alt](/a.png "Caption")' },
  { id: "image-color-scheme", summary: "Image shown only in light or dark mode", example: "![Logo](/logo-dark.png#gh-dark-mode-only)" },
  { id: "code-fence", summary: "Code with language, title, line ranges, line numbers, wrap", example: '```ts title="a.ts" {2} showLineNumbers wrap\ncode\n```' },
  { id: "code-notation", summary: "Line markers stripped from output", example: "x() // [!code ++]  |  // [!code highlight:2]  |  // [!code word:x]" },
  { id: "code-inline-lang", summary: "Highlighted inline code", example: "`fetch(url){:ts}`" },
  { id: "code-group", summary: "Tabbed fences, labelled by title or [label]", example: ':::code-group\n```ts title="a.ts"\n...\n```\n```js [a.js]\n...\n```\n:::' },
  { id: "package-install", summary: "npm command expanded into npm/pnpm/yarn/bun tabs", example: "```package-install\nnpm i -D pkg\n```" },
  { id: "tabs", summary: "Labelled tabs; choice syncs by label", example: "::::tabs\n:::tab[A]\n...\n:::\n:::tab[B]\n...\n:::\n::::" },
  { id: "steps", summary: "Numbered steps from a list or one heading per step", example: ":::steps\n1. First\n2. Second\n:::" },
  { id: "math", summary: "KaTeX math; $$ only (single $ is literal)", example: "$$\nx^2\n$$  |  inline $$x^2$$  |  ```math" },
  { id: "mermaid", summary: "Mermaid diagram (max 5,000 characters)", example: "```mermaid\nflowchart LR\n  A --> B\n```" },
  { id: "youtube", summary: "Bare YouTube link becomes a video card", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { id: "footnote", summary: "Footnote", example: "Text.[^1]\n\n[^1]: Note." },
  { id: "gfm", summary: "Tables, task lists, strikethrough, autolinks", example: "| a | b |\n|---|---|\n| 1 | 2 |" },
];

export function formatGuideForPreset(presetId: PresetId): FormatGuideDto {
  const preset = THEME_PRESETS[presetId];
  const layoutCap = preset.layout;
  return {
    activePresetId: preset.id,
    activePresetName: preset.name,
    guideVersion: GUIDE_VERSION,
    rendererVersion: RENDERER_VERSION,
    recommendedComponents: preset.recommendedComponents,
    presetGuidance: preset.formatGuide,
    examples: V1_EXAMPLES,
    syntax: SYNTAX,
    presentationOptions: {
      supportedLayouts: [...layoutCap.supportedLayouts],
      default: layoutCap.default,
      supportsToc: layoutCap.supportsToc,
      notes: PRESENTATION_NOTES,
    },
  };
}

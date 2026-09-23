import type { FormatGuideDto } from "@vc/api-contract";
import { THEME_PRESETS, type PresetId } from "@vc/config";
import { RENDERER_VERSION } from "@vc/content";

/** Bumped when the v1 syntax vocabulary changes. */
export const GUIDE_VERSION = "3";

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

=== Inline HTML (GitHub-safe tags only) ===
Press <kbd>Cmd</kbd> + <kbd>K</kbd>. H<sub>2</sub>O and x<sup>2</sup> work.
<!-- Scripts, iframes, styles, and unknown tags are removed and reported as warnings by posts.preview. -->
`.trim();

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
    presentationOptions: {
      supportedLayouts: [...layoutCap.supportedLayouts],
      default: layoutCap.default,
      supportsToc: layoutCap.supportsToc,
      notes: PRESENTATION_NOTES,
    },
  };
}

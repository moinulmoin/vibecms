import type { FormatGuideDto } from "@vc/api-contract";
import { RENDERER_VERSION } from "../lib/markdown";

/** Bumped when the v1 syntax vocabulary changes. */
export const GUIDE_VERSION = "1";

export { RENDERER_VERSION };

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

=== Callouts (BAD - non-standard type renders as a plain blockquote) ===
> [!WARN]    <- typo; use [!WARNING]
> [!info]    <- lowercase; use [!NOTE]

=== Table of contents (GOOD) ===
[[toc]]

## Introduction
## Setup
### Advanced options

=== Table of contents (BAD - no marker means no TOC; auto-TOC is not supported) ===
<!-- Without [[toc]], no table of contents is generated. Place [[toc]] explicitly. -->

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
`.trim();

// 015 makes this preset-aware (keyed off sites.theme)
export const universalFormatGuide: FormatGuideDto = {
  activePresetId: "minimal",
  activePresetName: "Minimal",
  guideVersion: GUIDE_VERSION,
  rendererVersion: RENDERER_VERSION,
  recommendedComponents: [
    "callout",
    "table-of-contents",
    "captioned-image",
    "fenced-code",
    "table",
    "list",
    "link",
    "bold-italic",
  ],
  presetGuidance:
    "Write clearly and directly. Prefer short sentences and concrete examples. " +
    "Use callouts sparingly - one per section at most. Let structure carry meaning.",
  examples: V1_EXAMPLES,
};

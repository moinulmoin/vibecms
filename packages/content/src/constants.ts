/** Dependency-free constants, so servers can read them without loading the renderer. */
export const RENDERER_VERSION = "4";
export const MISSING_IMAGE_ALT_WARNING = "Image is missing alt text";

/**
 * Stable, machine-readable warning codes. `RenderResult.warnings` keeps the
 * human sentences; `RenderResult.warningCodes` carries these codes in the same
 * order, so agents can branch on a code instead of parsing prose.
 */
export const RENDER_WARNING = {
  IMAGE_MISSING_ALT: "image-missing-alt",
  CALLOUT_UNKNOWN: "callout-unknown",
  TOC_NO_HEADINGS: "toc-no-headings",
  TOC_SUGGESTED: "toc-suggested",
  DIRECTIVE_UNKNOWN: "directive-unknown",
  HTML_REMOVED: "html-removed",
  CODE_FENCE_NO_LANGUAGE: "code-fence-no-language",
  HEADING_ID_INVALID: "heading-id-invalid",
  HEADING_ID_DUPLICATE: "heading-id-duplicate",
  MATH_INVALID: "math-invalid",
  MATH_TOO_LARGE: "math-too-large",
  DIAGRAM_TOO_LARGE: "diagram-too-large",
  TABS_INVALID: "tabs-invalid",
  STEPS_INVALID: "steps-invalid",
} as const;

export type RenderWarningCode = (typeof RENDER_WARNING)[keyof typeof RENDER_WARNING];

/** Message prefixes -> code, for consumers that only kept the warning strings. */
const WARNING_PREFIXES: readonly (readonly [string, RenderWarningCode])[] = [
  [MISSING_IMAGE_ALT_WARNING, RENDER_WARNING.IMAGE_MISSING_ALT],
  ["Unknown callout type", RENDER_WARNING.CALLOUT_UNKNOWN],
  ["[[toc]] marker present", RENDER_WARNING.TOC_NO_HEADINGS],
  ["Post has more than 600 words", RENDER_WARNING.TOC_SUGGESTED],
  ["Unknown block", RENDER_WARNING.DIRECTIVE_UNKNOWN],
  ["HTML <", RENDER_WARNING.HTML_REMOVED],
  ["One or more code fences are missing a language", RENDER_WARNING.CODE_FENCE_NO_LANGUAGE],
  ["Invalid heading id", RENDER_WARNING.HEADING_ID_INVALID],
  ["Duplicate heading id", RENDER_WARNING.HEADING_ID_DUPLICATE],
  ["Math could not be rendered", RENDER_WARNING.MATH_INVALID],
  ["Math exceeds", RENDER_WARNING.MATH_TOO_LARGE],
  ["Diagram exceeds", RENDER_WARNING.DIAGRAM_TOO_LARGE],
  ["Tabs", RENDER_WARNING.TABS_INVALID],
  ["Steps", RENDER_WARNING.STEPS_INVALID],
];

/** Maps a warning sentence back to its stable code (null for unknown text). */
export function renderWarningCode(message: string): RenderWarningCode | null {
  for (const [prefix, code] of WARNING_PREFIXES) if (message.startsWith(prefix)) return code;
  return null;
}

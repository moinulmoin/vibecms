/**
 * KaTeX-backed TeX renderer (`@vc/content/math`).
 *
 * Its own entry, like the highlighter, so surfaces that don't render math
 * never pay for KaTeX. Output is MathML only: browsers render it natively, so
 * no KaTeX stylesheet or fonts are needed, and the TeX source rides along in
 * the MathML `<annotation>` for copy/paste and assistive tech.
 */
import katex from "katex";
import { fromHtml } from "hast-util-from-html";
import type { MathRenderer, RenderedMath } from "./types.js";

type HastNode = { type: string; tagName?: string; children?: HastNode[]; [key: string]: unknown };

function findMath(nodes: HastNode[]): HastNode | null {
  for (const n of nodes) {
    if (n.type !== "element") continue;
    if (n.tagName === "math") return n;
    const inner = findMath(n.children ?? []);
    if (inner) return inner;
  }
  return null;
}

/**
 * User macro definitions are the only way TeX can amplify: `\def\a{<9 KB>}`
 * then `\a` x95 is ~8.5 MB of MathML. Builtins stay bounded (<~90x, e.g. an all-`&` matrix).
 */
const MACRO_DEFINITION = /\\(?:[gex]?def|let|futurelet|global|(?:new|renew|provide)command)(?![a-zA-Z])/;
/** Output guard (defense in depth): MathML characters allowed per TeX character. */
const MAX_OUTPUT_RATIO = 128;

export function createMathRenderer(): MathRenderer {
  return {
    render(tex, displayMode): RenderedMath {
      if (MACRO_DEFINITION.test(tex)) return { error: "custom macros (\\def, \\newcommand) are not supported" };
      let html: string;
      try {
        html = katex.renderToString(tex, {
          displayMode,
          output: "mathml",
          // Parse errors become a warning + plain-source fallback (never thrown to the page).
          throwOnError: true,
          trust: false,
          strict: "ignore",
          maxSize: 10,
          // KaTeX's default; builtins like \neq count too, and user macros are refused above.
          maxExpand: 1000,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message.replace(/^KaTeX parse error:\s*/, "").slice(0, 160) };
      }
      if (html.length > MAX_OUTPUT_RATIO * tex.length + 10_000) return { error: "output too large" };
      const math = findMath(fromHtml(html, { fragment: true }).children as HastNode[]);
      return math ? { nodes: [math] } : { error: "empty output" };
    },
  };
}

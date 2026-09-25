// Kitchen sink for v4 Markdown blocks: /blocks.html?preset=&mode=light|dark&font=&accent=&feed=1
// Loads the real public enhancer (apps/public/src/scripts/blocks.js) + same-origin Mermaid.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "@vc/ui/styles/fonts";
import "../src/styles/vc-rich-content.css";
import "../src/styles/presets.css";
import { resolvePresentation, resolvePresetId } from "@vc/config";
import { renderRichContent } from "../src/renderer";
import { createCodeHighlighter } from "../src/highlight";
import { PresentedPostArticle, siteThemeRootAttributes } from "../src/presented-post";
import { PublicPageChrome } from "../src/public-chrome";
import { BLOCKS_SAMPLE } from "./blocks-sample";
import blocksScriptUrl from "../../../apps/public/src/scripts/blocks.js?url";
import mermaidScriptUrl from "../../../apps/public/node_modules/@mermaid-js/tiny/dist/mermaid.tiny.js?url";

const q = new URLSearchParams(location.search);
const presetId = resolvePresetId(q.get("preset"));
const theme = { accent: q.get("accent"), font: q.get("font"), mode: q.get("mode") ?? "light" };
for (const [k, v] of Object.entries(siteThemeRootAttributes(presetId, theme))) {
  document.documentElement.setAttribute(k, v);
}
document.documentElement.style.background = "var(--vc-bg)";

const { resolved } = resolvePresentation(presetId, { toc: false });
const result = renderRichContent(BLOCKS_SAMPLE, {
  highlighter: createCodeHighlighter(),
  target: q.get("feed") ? "feed" : "web",
});
(window as unknown as { __warnings: string[] }).__warnings = result.warnings;

flushSync(() =>
  createRoot(document.getElementById("root")!).render(
    <PublicPageChrome siteName="Field Notes" homeHref="/" allPostsHref="/" presetId={presetId} theme={theme} article feedHref="/feed.xml" subscribeVariant="end">
      <PresentedPostArticle
        renderResult={result}
        presetId={presetId}
        presentation={resolved}
        title="Markdown blocks"
        publishedAt={1790208000}
        readingMinutes={4}
        basePath=""
        theme={theme}
      />
    </PublicPageChrome>,
  ),
);

if (!q.get("nojs")) {
  const s = document.createElement("script");
  s.src = blocksScriptUrl;
  s.dataset.mermaidSrc = mermaidScriptUrl;
  document.body.append(s);
}

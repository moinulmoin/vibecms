import { createRoot } from "react-dom/client";
import "@vc/ui/styles/fonts";
import "../src/styles/vc-rich-content.css";
import "../src/styles/presets.css";
import { resolvePresentation, resolvePresetId } from "@vc/config";
import { renderRichContent } from "../src/renderer";
import { createCodeHighlighter } from "../src/highlight";
import { PresentedPostArticle, articleHasToc, siteThemeRootAttributes } from "../src/presented-post";
import { PublicPageChrome } from "../src/public-chrome";
import { SAMPLE_POST } from "./sample";

const q = new URLSearchParams(location.search);
const presetId = resolvePresetId(q.get("preset"));
const theme = { accent: q.get("accent"), font: q.get("font"), mode: q.get("mode") ?? "light" };
for (const [k, v] of Object.entries(siteThemeRootAttributes(presetId, theme))) {
  document.documentElement.setAttribute(k, v);
}
document.documentElement.style.background = "var(--vc-bg)";

const { resolved } = resolvePresentation(presetId, { layout: (q.get("layout") as never) ?? undefined, toc: true });
const result = renderRichContent(SAMPLE_POST, { pageTitle: "Shipping a blog your agents can write", highlighter: createCodeHighlighter() });
const view = q.get("view") ?? "post";

function Index() {
  const posts = [
    ["Shipping a blog your agents can write", "How we let coding agents draft and publish without ever handing over the keys.", "Sep 24, 2026"],
    ["Versions are the product", "Every save is a snapshot you can diff and restore. Here's why that matters more than the editor.", "Sep 12, 2026"],
    ["Markdown, all the way down", "Callouts, footnotes, highlighted code, and a feed that reads cleanly everywhere.", "Aug 30, 2026"],
  ];
  return (
    <PublicPageChrome siteName="Field Notes" tagline="Notes on building calm software with agents." homeHref="/" homeHeading presetId={presetId} theme={theme} searchAction="/" feedHref="/feed.xml" subscribeVariant="footer">
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {posts.map(([t, e, d]) => (
          <li key={t} style={{ padding: "1.35rem 0", borderTop: "1px solid var(--vc-hairline)" }}>
            <h2 style={{ margin: "0 0 .35rem", fontSize: "1.1875rem", fontFamily: "var(--vc-font-heading)", fontWeight: 650 }}>{t}</h2>
            <p style={{ margin: "0 0 .5rem", color: "var(--vc-muted-fg)" }}>{e}</p>
            <p style={{ margin: 0, color: "var(--vc-muted-fg)", fontSize: ".8125rem" }}>{d}</p>
          </li>
        ))}
      </ol>
    </PublicPageChrome>
  );
}

function Post() {
  return (
    <PublicPageChrome siteName="Field Notes" homeHref="/" allPostsHref="/" presetId={presetId} theme={theme} article wide={articleHasToc(resolved, result.outline)} feedHref="/feed.xml" subscribeVariant="end">
      <PresentedPostArticle
        renderResult={result}
        presetId={presetId}
        presentation={resolved}
        title="Shipping a blog your agents can write"
        excerpt="How we let coding agents draft and publish without ever handing over the keys."
        publishedAt={1790208000}
        readingMinutes={6}
        tags={["agents", "mcp", "writing"]}
        basePath=""
        theme={theme}
        newer={{ title: "Versions are the product", href: "#" }}
        older={{ title: "Markdown, all the way down", href: "#" }}
      />
    </PublicPageChrome>
  );
}

const width = q.get("width");
createRoot(document.getElementById("root")!).render(
  <div style={{ maxWidth: width ? `${width}px` : undefined, margin: "0 auto", boxShadow: width ? "0 0 0 1px #8884" : undefined }}>
    {view === "index" ? <Index /> : <Post />}
  </div>,
);

if (q.has("debug")) {
  setTimeout(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 8)
      .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}:${Math.round(el.getBoundingClientRect().width)}`);
    document.body.setAttribute("data-debug", `vw=${vw} sw=${document.documentElement.scrollWidth} ${wide.join(" | ")}`);
  }, 1500);
}

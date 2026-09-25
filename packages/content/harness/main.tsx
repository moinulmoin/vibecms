import { createRoot } from "react-dom/client";
import "@vc/ui/styles/fonts";
import "../src/styles/vc-rich-content.css";
import "../src/styles/presets.css";
import { resolvePresentation, resolvePresetId } from "@vc/config";
import { renderRichContent } from "../src/renderer";
import { createCodeHighlighter } from "../src/highlight";
import { PresentedPostArticle, articleHasToc, siteThemeRootAttributes } from "../src/presented-post";
import { PublicPageChrome } from "../src/public-chrome";
import { PublicPostList } from "../src/public-post-list";
import { THEME_PRESETS } from "@vc/config";
import { SAMPLE_POST } from "./sample";

const q = new URLSearchParams(location.search);
const presetId = resolvePresetId(q.get("preset"));
const theme = { accent: q.get("accent"), font: q.get("font"), mode: q.get("mode") ?? "light", radius: q.get("radius"), width: q.get("width") };
for (const [k, v] of Object.entries(siteThemeRootAttributes(presetId, theme))) {
  document.documentElement.setAttribute(k, v);
}
document.documentElement.style.background = "var(--vc-bg)";

const { resolved } = resolvePresentation(presetId, { layout: (q.get("layout") as never) ?? THEME_PRESETS[presetId].layout.default.layout, toc: true });
const result = renderRichContent(SAMPLE_POST, { pageTitle: "Shipping a blog your agents can write", highlighter: createCodeHighlighter() });
const view = q.get("view") ?? "post";

const SIDEBAR = {
  recent: [
    { title: "Versions are the product", href: "#" },
    { title: "Markdown, all the way down", href: "#" },
    { title: "Designing for agents", href: "#" },
  ],
  tags: [
    { name: "agents", href: "#", count: 4 },
    { name: "mcp", href: "#", count: 3 },
    { name: "writing", href: "#", count: 2 },
    { name: "design", href: "#", count: 1 },
  ],
};

function Index() {
  const day = 86400;
  const t0 = 1790208000;
  const posts = [
    ["Shipping a blog your agents can write", "How we let coding agents draft and publish without ever handing over the keys.", t0, ["agents"]],
    ["Versions are the product", "Every save is a snapshot you can diff and restore. Here's why that matters more than the editor.", t0 - 12 * day, ["versions"]],
    ["Markdown, all the way down", "Callouts, footnotes, highlighted code, and a feed that reads cleanly everywhere.", t0 - 25 * day, ["markdown"]],
    ["Designing for agents", "What changes when half your authors are software.", t0 - 40 * day, ["design"]],
    ["A calm publishing loop", "Draft, review, publish. Nothing goes live by accident.", t0 - 47 * day, ["workflow"]],
  ] as const;
  return (
    <PublicPageChrome siteName="Field Notes" tagline="Notes on building calm software with agents." homeHref="/" homeHeading presetId={presetId} theme={theme} searchAction="/" feedHref="/feed.xml" subscribeVariant="footer" modeToggle sidebar={SIDEBAR}>
      <PublicPostList
        variant={THEME_PRESETS[presetId].template.index}
        posts={posts.map(([title, excerpt, at, tags], i) => ({ id: String(i), title, excerpt, publishedAt: at, tags: [...tags], href: "#" }))}
      />
    </PublicPageChrome>
  );
}

function Post() {
  return (
    <PublicPageChrome siteName="Field Notes" tagline="Notes on building calm software with agents." homeHref="/" allPostsHref="/" presetId={presetId} theme={theme} article wide={articleHasToc(resolved, result.outline)} layout={resolved.layout} feedHref="/feed.xml" subscribeVariant="end" modeToggle sidebar={SIDEBAR}>
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
        author={{ name: "Moinul", agent: q.get("agent") !== "0" }}
        actions={{ markdownUrl: "https://example.com/post.md", shareUrl: "https://example.com/post" }}
        newer={{ title: "Versions are the product", href: "#", publishedAt: 1790208000 - 86400 * 12 }}
        older={{ title: "Markdown, all the way down", href: "#", publishedAt: 1790208000 - 86400 * 25 }}
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

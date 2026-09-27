import {
  ACCENTS,
  FONTS,
  MEDIA,
  STARTER_LOOKS,
  THEME_PRESETS,
  getAccent,
  getFont,
  type PresetId,
} from "@vc/config";
import type { ComponentType, CSSProperties, SVGProps } from "react";
import {
  Bot,
  ChartColumn,
  Code,
  Download,
  Globe,
  ImageIcon,
  Link,
  Mail,
  PenLine,
  Rss,
  Search,
  Zap,
} from "./icons";
import { DotGrid, H2, LEAD, SectionShell } from "./primitives";

type Feature = {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
};

const GROUPS: { title: string; items: Feature[] }[] = [
  {
    title: "For your readers",
    items: [
      { Icon: Globe, title: "Your own domain", body: "Point blog.yours.com at it. Certificates are handled for you." },
      { Icon: Zap, title: "Fast by default", body: "Rendered on Cloudflare's edge, cached close to readers." },
      { Icon: Code, title: "Code and math", body: "Highlighting and formulas, loaded only on posts that use them." },
      { Icon: Search, title: "Tags and search", body: "Readers browse by tag or search every post." },
    ],
  },
  {
    title: "For search and AI",
    items: [
      { Icon: Rss, title: "RSS, sitemap, SEO", body: "Feeds, sitemap, canonical URLs, structured data, and social cards." },
      { Icon: Bot, title: "Readable by agents", body: "llms.txt, a Markdown version of every page, and discovery files agents look for." },
      { Icon: ChartColumn, title: "Analytics, AI included", body: "Views and referrers, plus AI crawler hits and visits from AI search." },
      { Icon: Link, title: "Old links keep working", body: "Rename a post and its old URL redirects to the new one." },
    ],
  },
  {
    title: "Yours to keep",
    items: [
      { Icon: PenLine, title: "Voice profile", body: "Describe how you write. Agents read it before they draft." },
      { Icon: ImageIcon, title: "Media on R2", body: `Images up to ${MEDIA.maxImageLabel}, ${MEDIA.paidStorageLabel} of storage, resized at the edge.` },
      { Icon: Mail, title: "Newsletter signups", body: "A subscribe form on your blog. Export the list as CSV." },
      { Icon: Download, title: "Export anytime", body: "Every post as JSON, whenever you want it. No lock-in." },
    ],
  },
];

// Same names the dashboard shows (Minimal, Editorial, Notebook, Magazine).
const THEMES = (["minimal", "editorial", "technical", "product"] as const satisfies readonly PresetId[]).map(
  (id) => [id, THEME_PRESETS[id].name] as const,
);

const DEFAULT_PREVIEW: PresetId = "technical";

const THEME_TITLES: Record<PresetId, string> = {
  minimal: "Clear notes",
  editorial: "Field Notes",
  technical: "01 / GUIDE",
  product: "New: Launch",
};

function presetStyle(id: PresetId): CSSProperties {
  const starter =
    id === "minimal"
      ? { accent: "teal" as const, font: "geist-sans" as const }
      : STARTER_LOOKS[id];
  const accent = getAccent(starter.accent);
  const font = getFont("font" in starter ? starter.font : "geist-sans");
  return {
    "--vc-accent-light": accent.oklchLight,
    "--vc-accent-dark": accent.oklchDark,
    "--vc-font-body": font.bodyStack,
    "--vc-font-heading": font.headingStack,
  } as CSSProperties;
}

function ThemeSwatch({ id, name }: { id: PresetId; name: string }) {
  return (
    <button
      type="button"
      data-theme-pick={id}
      data-theme-vars={JSON.stringify(presetStyle(id))}
      aria-pressed={id === DEFAULT_PREVIEW ? "true" : "false"}
      aria-label={`Preview the ${name} theme`}
      className="group m-0 cursor-pointer rounded-[12px] p-0 text-left"
    >
      <div
        data-vc-theme={id}
        data-vc-mode="dark"
        style={presetStyle(id)}
        className="rounded-[var(--vc-radius)] border border-vc-border bg-vc-bg p-3 transition-[transform,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5 group-aria-pressed:shadow-[0_0_0_1.5px_var(--brand-bright)] motion-reduce:group-hover:translate-y-0"
        aria-hidden="true"
      >
        <div className="h-1.5 w-7 rounded-full bg-vc-accent" />
        <p
          className={[
            "mt-2 truncate text-[10px] leading-tight text-vc-fg",
            id === "editorial"
              ? "font-[family-name:var(--vc-font-heading)] italic"
              : id === "technical"
                ? "font-mono text-[9px] tracking-[0.08em]"
                : "font-[family-name:var(--vc-font-heading)] font-semibold",
          ].join(" ")}
        >
          {THEME_TITLES[id]}
        </p>
        <div className="mt-1.5 h-1 w-4/5 rounded-full bg-vc-fg/25" />
        <div className="mt-1 h-1 w-2/3 rounded-full bg-vc-fg/25" />
      </div>
      <span className="mt-2 block text-center font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-foreground group-aria-pressed:text-foreground">
        {name}
      </span>
    </button>
  );
}

// Static stand-in for a rendered post: TOC, callout, highlighted code, footnote.
function PostMock() {
  return (
    <div
      data-vc-theme={DEFAULT_PREVIEW}
      data-vc-mode="dark"
      data-theme-target
      style={presetStyle(DEFAULT_PREVIEW)}
      className="overflow-hidden rounded-2xl bg-vc-bg text-left text-vc-fg ring-1 ring-[color:var(--hairline)]"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-3 border-b border-vc-border px-5 py-3">
        <span className="truncate font-mono text-[11px] text-vc-muted-fg">
          blog.acme.com/shipping-with-mcp
        </span>
        <span className="shrink-0 font-mono text-[11px] text-vc-muted-fg">light · dark</span>
      </div>
      <div className="grid gap-6 px-5 py-6 sm:px-7 md:grid-cols-[1fr_150px]">
        <article className="min-w-0 font-[family-name:var(--vc-font-body)]">
          <p className="font-mono text-[11px] text-vc-muted-fg">Sep 24 · 4 min read</p>
          <h3 className="mt-1.5 font-[family-name:var(--vc-font-heading)] text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            Shipping with MCP
          </h3>
          <p className="mt-3 text-[13.5px] leading-[1.65] text-vc-fg/85">
            Our agent drafts release notes from merged PRs. We review, then
            publish the exact version.<sup className="ml-0.5 text-[10px] text-vc-link">1</sup>
          </p>
          <div className="mt-4 rounded-r-md border-l-2 border-vc-accent bg-vc-muted px-3.5 py-2.5 text-[12.5px] leading-[1.55]">
            <span className="font-semibold text-vc-accent">Note</span>
            <span className="text-vc-fg/85"> Tokens are scoped per agent.</span>
          </div>
          <pre className="mt-4 overflow-hidden rounded-lg bg-[oklch(0.2_0.01_250)] ring-1 ring-vc-border px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] text-[oklch(0.9_0.01_250)]">
            <code>
              <span className="text-[oklch(0.72_0.14_300)]">await</span> vibecms.posts.
              <span className="text-[oklch(0.78_0.12_230)]">publish</span>({"{"}
              {"\n"}  postId,{"\n"}  expectedVersionNumber:{" "}
              <span className="text-[oklch(0.8_0.12_70)]">7</span>,{"\n"}
              {"}"})
            </code>
          </pre>
          <p className="mt-4 border-t border-vc-border pt-2.5 text-[11px] text-vc-muted-fg">
            1. Nothing ships without a human nod.
          </p>
        </article>
        <nav className="hidden border-l border-vc-border pl-4 text-[11.5px] leading-[1.9] md:block">
          <p className="font-mono text-[10.5px] text-vc-muted-fg">On this page</p>
          <p className="mt-1 text-vc-accent">Why MCP</p>
          <p className="text-vc-muted-fg">The workflow</p>
          <p className="text-vc-muted-fg">Rolling back</p>
        </nav>
      </div>
    </div>
  );
}

export function BlogFeatures() {
  return (
    <section id="features" aria-labelledby="features-title" className="relative isolate">
      <DotGrid className="-z-10" />
      <SectionShell>
        <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
          <div data-reveal className="min-w-0">
            <h2 id="features-title" className={H2}>
              Your agent writes Markdown.
              <br />
              Readers get a real blog.
            </h2>
            <p className={`mt-4 max-w-[440px] ${LEAD}`}>
              Callouts, highlighted code with copy buttons, tables of contents,
              footnotes, and responsive images. Rendered fast, in light and dark.
            </p>
            <div className="mt-8 grid max-w-[440px] grid-cols-2 gap-3 min-[440px]:grid-cols-4">
              {THEMES.map(([id, name]) => (
                <ThemeSwatch key={id} id={id} name={name} />
              ))}
            </div>
            <p className="mt-4 text-sm leading-[1.6] text-muted-foreground">
              Four themes, {ACCENTS.length} accents, {FONTS.length} font pairings.
              <span className="text-foreground/80"> Pick one to preview it.</span>
            </p>
          </div>
          <div data-reveal data-d="1" className="min-w-0">
            <PostMock />
          </div>
        </div>

        <div className="mt-16 grid gap-x-10 gap-y-12 md:mt-24 md:grid-cols-3" data-reveal>
          {GROUPS.map((group) => (
            <div key={group.title} className="min-w-0">
              <h3 className="font-mono text-xs text-muted-foreground">{group.title}</h3>
              <ul className="mt-5 grid gap-6">
                {group.items.map(({ Icon, title, body }) => (
                  <li key={title} className="group flex gap-3.5">
                    <Icon className="mt-0.5 size-[18px] shrink-0 text-foreground/70 transition-[color,transform] duration-200 group-hover:-translate-y-px group-hover:text-foreground motion-reduce:group-hover:translate-y-0" />
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-foreground">{title}</p>
                      <p className="mt-1 text-sm leading-[1.55] text-muted-foreground">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionShell>
    </section>
  );
}

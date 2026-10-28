/**
 * Deterministic, pure SEO and AI-answer (GEO) checks (plans 024 and 028).
 * `seoChecks` runs over the hast from `parseSeoMarkdown` — no DB, no
 * renderer, no AI model — and returns `SeoFinding`s
 * sorted by severity (error, warn, info), then code lexically, then position.
 * `position` on a finding is the Markdown character offset where the
 * offending element starts, when remark retained it.
 *
 * Same-site link interpretation matches the renderer's `relocateRootUrl`:
 * root-relative targets are post-slug candidates by first path segment even
 * outside `primaryBaseUrl`'s base path (they get rewritten when the segment
 * is a published slug); absolute same-host URLs count only under the base
 * path. `.md` suffixes, `/media-assets/*`, and reserved routes
 * (`feed.xml`, `docs`, `tag/*`, `preview/*`, …) never produce candidates.
 */

import { RESERVED_POST_SLUGS } from "@vc/config";

import { MISSING_IMAGE_ALT_WARNING, renderWarningCode, RENDER_WARNING } from "./constants.js";
import { seoMarkdownTreeWithoutTitleH1 } from "./renderer.js";
import type { SeoMarkdownElement, SeoMarkdownNode, SeoMarkdownTree } from "./types.js";

export type SeoSeverity = "error" | "warn" | "info";

export interface SeoFinding {
  readonly code: SeoFindingCode;
  readonly severity: SeoSeverity;
  /** Input field the finding attaches to; `content` for anything from the body. */
  readonly field: string;
  readonly message: string;
  readonly fix: string;
  /** Markdown character offset of the offending element, when known. */
  readonly position?: number;
}

/** Stable check codes — part of the API contract. */
export const SEO_FINDING_CODES = [
  "title-length",
  "description-missing",
  "description-length",
  "slug-long",
  "slug-format",
  "h1-in-body",
  "heading-skip",
  "heading-empty",
  "heading-duplicate",
  "link-internal-broken",
  "link-insecure",
  "link-anchor-generic",
  "link-none-internal",
  "content-thin",
  "paragraph-long",
  "image-alt-missing",
  "social-image-default",
  "duplicate-title",
  "duplicate-description",
  "canonical-external",
  "site-not-indexable",
  "keyword-title",
  "keyword-slug",
  "keyword-intro",
  "keyword-heading",
  "keyword-description",
  "answer-intro-missing",
  "answer-intro-long",
  "answer-claim-unsourced",
  "answer-section-long",
  "answer-steps-prose",
] as const;

export type SeoFindingCode = (typeof SEO_FINDING_CODES)[number];

export interface SeoCheckInput {
  readonly title: string;
  readonly slug: string;
  readonly seoTitle?: string | null;
  readonly seoDescription?: string | null;
  readonly excerpt?: string | null;
  readonly canonicalUrl?: string | null;
  readonly coverAssetId?: string | null;
  /** Tree from `parseSeoMarkdown(markdown)`. */
  readonly tree: SeoMarkdownTree;
  readonly site: {
    /** False when search/AI indexing is off for this site (hosted free). */
    readonly indexable: boolean;
    /** Canonical public URL of the blog root, e.g. `https://tenant.dev/blog`; null when unknown. */
    readonly primaryBaseUrl: string | null;
  };
  /** Resolved post slugs and exact blog-relative redirect paths. */
  readonly publishedSlugs: readonly string[];
  /**
   * Other published posts of the site for duplicate detection. `title`/
   * `description` are the *effective* values the caller compares against
   * (seoTitle ?? title, seoDescription ?? excerpt) — same synthesis as this
   * post's effective values.
   */
  readonly otherPosts: readonly { readonly title: string; readonly description: string | null }[];
  /**
   * False when the caller passes body content without the post's saved
   * metadata (e.g. a raw-Markdown preview): title/slug/canonical/cover are
   * unknown, so checks whose inputs they are — metadata length/presence,
   * duplicates, keyword-in-title/slug/description — are skipped rather than
   * reported against empty stand-ins. Omit or pass true when the metadata
   * fields carry real values.
   */
  readonly metadataKnown?: boolean;
  /** Optional focus keyword; adds `keyword-*` findings (normalized like slugs: `-`/`_` act as spaces). */
  readonly focusKeyword?: string | null;
  /**
   * Render warnings already produced for this content, when the caller has
   * them (e.g. from `renderRichContent`). Each `image-missing-alt` warning
   * maps to one `image-alt-missing` finding; when omitted the tree's `img`
   * elements are inspected directly instead — never both.
   */
  readonly renderWarnings?: readonly string[];
}

// ─── Link classification ────────────────────────────────────────────────

const MEDIA_ASSETS_PREFIX = "/media-assets/";
const RESERVED: Record<string, true> = Object.fromEntries(RESERVED_POST_SLUGS.map((slug) => [slug, true]));

/**
 * Tenant routes that are never posts — links to them are not broken.
 * `tag`/`preview` have real route trees; `og` and `_astro` cover generated
 * share cards and build assets under their own roots.
 */
const STATIC_ROUTE_SEGMENTS: Record<string, true> = { tag: true, preview: true, og: true, _astro: true };

interface ParsedBase {
  readonly url: URL;
  /** Pathname without a trailing slash; `""` for root hosting. */
  readonly path: string;
}

function parsePrimaryBaseUrl(raw: string | null): ParsedBase | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { url, path: url.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

interface LinkTarget {
  /**
   * Post-slug candidate: first path segment under the site base path with a
   * `.md` suffix stripped. Null when the target can never be a post link
   * (media assets, reserved routes, generated `/og*`/`/_astro` assets, file
   * paths with an extension, `#`/`?` targets, the blog root).
   */
  readonly candidate: string | null;
  /** Full blog-relative path for an exact site redirect lookup. */
  readonly redirectPath?: string;
  /**
   * True when the resolved path lives under the site's own base path, so
   * `publishedSlugs` decides whether it resolves. False for root-relative
   * paths outside a subpath site's base path — those keep their "customer
   * site's root" meaning and are never reported broken.
   */
  readonly inBlogSpace: boolean;
}

function linkTarget(raw: string, base: ParsedBase | null): LinkTarget | null {
  const value = raw.trim();
  if (!value) return null;

  let path: string;
  let inBlogSpace = true;
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null; // protocol-relative → external host
    path = value.split(/[?#]/, 1)[0]!;
    if (base?.path) {
      inBlogSpace = path === base.path || path.startsWith(`${base.path}/`);
      if (inBlogSpace) path = path.slice(base.path.length) || "/";
    }
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    // Absolute URL: only same-host targets under the base path are post links.
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!base || url.host !== base.url.host) return null;
    path = url.pathname;
    if (base.path) {
      if (path !== base.path && !path.startsWith(`${base.path}/`)) return null;
      path = path.slice(base.path.length) || "/";
    }
  } else {
    return null; // bare relative target — not resolvable site-side
  }

  const segment = path.startsWith("/") ? path.slice(1).split("/", 1)[0]! : "";
  if (!segment) return { candidate: null, inBlogSpace };
  const lowered = segment.toLowerCase();
  if (lowered === MEDIA_ASSETS_PREFIX.slice(1, -1) || STATIC_ROUTE_SEGMENTS[lowered]) return null;
  const candidate = lowered.endsWith(".md") ? segment.slice(0, -3) : segment;
  // Reserved routes (feed.xml, docs, llms.txt, …) compare on the lowered,
  // .md-stripped form; any other dotted segment is a file/asset path (og.png,
  // docs-search.json), never a post slug.
  if (!candidate || RESERVED[candidate.toLowerCase()] || candidate.includes(".")) {
    return { candidate: null, inBlogSpace };
  }
  return { candidate, inBlogSpace, redirectPath: inBlogSpace ? path : undefined };
}

function isEl(node: SeoMarkdownNode): node is SeoMarkdownElement {
  return node.type === "element";
}

/**
 * Post-slug candidates and full blog-relative redirect paths referenced by
 * `href`, `src`, or `srcSet`. Sorted, deduped, uncapped: callers chunk DB
 * lookups rather than dropping links and inventing broken-link errors.
 */
export function collectSeoLinkSlugs(tree: SeoMarkdownTree, primaryBaseUrl: string | null): string[] {
  const base = parsePrimaryBaseUrl(primaryBaseUrl);
  const slugs = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const target = linkTarget(value, base);
    if (target?.candidate) slugs.add(target.candidate);
    if (target?.candidate && target.redirectPath) slugs.add(target.redirectPath);
  };
  const walk = (children: readonly SeoMarkdownNode[]) => {
    for (const node of children) {
      if (!isEl(node)) continue;
      add(node.properties.href);
      add(node.properties.src);
      if (typeof node.properties.srcSet === "string") {
        for (const part of node.properties.srcSet.split(",")) add(part.trim().split(/\s+/, 1)[0]);
      }
      walk(node.children);
    }
  };
  walk(tree.children);
  return [...slugs].sort();
}

// ─── Document model ─────────────────────────────────────────────────────

/** Subtrees whose text is never body prose. Code stays code. */
const SKIP_BODY_TEXT: Record<string, true> = {
  pre: true,
  script: true,
  style: true,
  textarea: true,
  iframe: true,
  noscript: true,
  svg: true,
};

const GENERIC_ANCHOR_TEXT: Record<string, true> = {
  "click here": true,
  here: true,
  "read more": true,
  this: true,
};

const HEADING_TAG = /^h([1-6])$/;

/**
 * Containers whose paragraphs are never the post's opening answer: a callout,
 * list item, or table cell before the first heading is not an intro.
 */
const NON_INTRO_CONTAINER: Record<string, true> = {
  blockquote: true,
  ul: true,
  ol: true,
  li: true,
  table: true,
  details: true,
  aside: true,
  figure: true,
  section: true,
  dl: true,
};

interface HeadingEntry {
  level: number;
  text: string;
  position?: number;
  /** Index into `bodyWords` where the heading's own text starts. */
  textStart: number;
  /** Index into `bodyWords` right after the heading's own text: its section starts here. */
  sectionStart: number;
}

interface ParagraphEntry {
  words: number;
  position?: number;
  /** Prose text with inline `code` removed, for claim and step detection. */
  prose: string;
  /** True when any link (including footnote references) sits inside the paragraph. */
  hasLink: boolean;
  /** False for paragraphs inside lists, quotes, tables and similar containers. */
  topLevel: boolean;
}

interface DocModel {
  readonly headings: HeadingEntry[];
  readonly anchors: { text: string; position?: number }[];
  /** Raw `href`/`src`/`srcSet` values on any element, in document order. */
  readonly linkRefs: { raw: string; position?: number }[];
  readonly imagesMissingAlt: { position?: number }[];
  readonly paragraphs: ParagraphEntry[];
  /** Body text words (pre/script/style subtrees excluded), in order. */
  readonly bodyWords: string[];
  /**
   * The opening answer: the first top-level paragraph with words, when it
   * comes before every heading. Null when a heading (or nothing) comes first.
   */
  intro: { words: number; position?: number } | null;
}

function offsetOf(el: SeoMarkdownElement): number | undefined {
  const offset = el.position?.start?.offset;
  return typeof offset === "number" ? offset : undefined;
}

function elText(el: SeoMarkdownElement): string {
  let out = "";
  const walk = (children: readonly SeoMarkdownNode[]) => {
    for (const node of children) {
      if (isEl(node)) walk(node.children);
      else if (typeof node.value === "string") out += node.value;
    }
  };
  walk(el.children);
  return out;
}

function countWords(text: string): number {
  let words = 0;
  for (const word of text.split(/\s+/)) if (word) words += 1;
  return words;
}

/** Paragraph text without inline code, plus whether a link sits inside it. */
function paragraphProse(el: SeoMarkdownElement): { prose: string; hasLink: boolean } {
  let prose = "";
  let hasLink = false;
  const walk = (children: readonly SeoMarkdownNode[]) => {
    for (const node of children) {
      if (isEl(node)) {
        if (node.tagName === "a" && typeof node.properties.href === "string" && node.properties.href.trim()) hasLink = true;
        if (node.tagName !== "code") walk(node.children);
      } else if (typeof node.value === "string") {
        prose += node.value;
      }
    }
  };
  walk(el.children);
  return { prose, hasLink };
}

function buildModel(tree: SeoMarkdownTree): DocModel {
  const model: DocModel = {
    headings: [],
    anchors: [],
    linkRefs: [],
    imagesMissingAlt: [],
    paragraphs: [],
    bodyWords: [],
    intro: null,
  };
  // The opening is decided by whichever comes first in document order: a
  // heading (no intro) or a top-level paragraph with words (the intro).
  let introDecided = false;
  const walk = (children: readonly SeoMarkdownNode[], skipText: boolean, inContainer: boolean) => {
    for (const node of children) {
      if (!isEl(node)) {
        if (!skipText && typeof node.value === "string") {
          // Loop, not push(...words): a long text node can hold more words than
          // the engine's function-argument limit.
          for (const word of node.value.split(/\s+/)) if (word) model.bodyWords.push(word);
        }
        continue;
      }
      const p = node.properties;
      const position = offsetOf(node);
      if (typeof p.href === "string") model.linkRefs.push({ raw: p.href, position });
      if (typeof p.src === "string") model.linkRefs.push({ raw: p.src, position });
      if (typeof p.srcSet === "string") {
        for (const part of p.srcSet.split(",")) {
          const raw = part.trim().split(/\s+/, 1)[0];
          if (raw) model.linkRefs.push({ raw, position });
        }
      }
      const heading = HEADING_TAG.exec(node.tagName);
      let headingEntry: HeadingEntry | null = null;
      if (heading) {
        const textStart = model.bodyWords.length;
        headingEntry = { level: Number(heading[1]), text: elText(node), position, textStart, sectionStart: textStart };
        model.headings.push(headingEntry);
        introDecided = true;
      }
      if (node.tagName === "a") model.anchors.push({ text: elText(node), position });
      if (node.tagName === "img") {
        const alt = p.alt;
        if (typeof alt !== "string" || !alt.trim()) model.imagesMissingAlt.push({ position });
      }
      if (node.tagName === "p") {
        const words = countWords(elText(node));
        const { prose, hasLink } = paragraphProse(node);
        model.paragraphs.push({ words, position, prose, hasLink, topLevel: !inContainer });
        if (!introDecided && !inContainer && !skipText && words > 0) {
          model.intro = { words, position };
          introDecided = true;
        }
      }
      walk(node.children, skipText || SKIP_BODY_TEXT[node.tagName] === true, inContainer || NON_INTRO_CONTAINER[node.tagName] === true);
      if (headingEntry) headingEntry.sectionStart = model.bodyWords.length;
    }
  };
  walk(tree.children, false, false);
  return model;
}

// ─── Checks ─────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<SeoSeverity, number> = { error: 0, warn: 1, info: 2 };
const DATE_LIKE_SLUG = /^\d{4}([-/])\d{2}\1\d{2}($|[-/])|^\d{4}[-/]\d{2}($|[-/])|^\d{4}$/;
/**
 * One compare-normalization for every text equality in the checks: NFKD to
 * decompose accents, combining marks stripped, lowercased, whitespace
 * collapsed. SQLite's lower() stops at ASCII, so "Édition" vs "édition" must
 * be compared in JS on both sides.
 */
const normalizeForCompare = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** `[-_]` in a slug or keyword behaves like a space for matching. */
const normalizeKeywordText = (value: string) => normalizeForCompare(value.replace(/[-_]+/g, " "));

const TITLE_MIN = 15;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;
const SLUG_MAX = 75;
const THIN_WORDS = 300;
const LONG_PARAGRAPH_WORDS = 150;
const INTRO_WORDS = 100;
/** An opening paragraph longer than this no longer reads as a quotable answer. */
const INTRO_ANSWER_MAX_WORDS = 80;
/** Text under one heading past this is too long for an AI answer to quote as one passage. */
const SECTION_MAX_WORDS = 400;
/** Fewest sentence-start sequence words ("First", "Then", "Finally") that read as steps. */
const STEP_MARKERS_MIN = 3;

/**
 * A number claim worth a source: a percentage, a multiplier comparison
 * ("3x faster"), or a large count ("2 million"). Plain counts, versions,
 * years, and prices are not claims and stay quiet.
 */
const NUMBER_CLAIM =
  /\d(?:[\d,.]*\d)?\s?(?:%|percent\b|per cent\b)|\b\d(?:[\d,.]*\d)?\s?(?:x|×|times)\s+(?:faster|slower|more|less|fewer|cheaper|better|worse|bigger|smaller|higher|lower)\b|\b\d(?:[\d,.]*\d)?\s+(?:million|billion|trillion)\b/i;
/** Sequence words at the start of a sentence. */
const STEP_MARKER =
  /(?:^|[.!?:;]\s+)(firstly|first|secondly|second|thirdly|third|fourth|fifth|next|then|after that|afterwards|finally|lastly|step\s+\d+)(?=[\s,:)])/gi;
/** Sequence words that only make sense in an ordered sequence; one must appear. */
const ORDINAL_MARKER = /^(?:firstly|first|secondly|second|thirdly|third|fourth|fifth|finally|lastly|step\s+\d+)$/i;
const STEP_PARAGRAPH = /^\s*step\s+\d+(?=[\s,:.)])/i;

export function seoChecks(input: SeoCheckInput): SeoFinding[] {
  const findings: SeoFinding[] = [];
  const add = (
    code: SeoFindingCode,
    severity: SeoSeverity,
    field: string,
    message: string,
    fix: string,
    position?: number,
  ) => findings.push(position === undefined ? { code, severity, field, message, fix } : { code, severity, field, message, fix, position });

  // The public renderer strips a leading `# <post title>` before display; the
  // SEO pass analyzes the same post-shape, so the same removal applies first.
  // With unknown metadata the title is empty and nothing is removed.
  const metadataKnown = input.metadataKnown !== false;
  const model = buildModel(seoMarkdownTreeWithoutTitleH1(input.tree, input.title));
  const base = parsePrimaryBaseUrl(input.site.primaryBaseUrl);
  const published = new Set(input.publishedSlugs);

  const effectiveTitle = (input.seoTitle?.trim() || input.title).trim();
  const effectiveDescription = input.seoDescription?.trim() || input.excerpt?.trim() || null;

  // ── Title / description / slug ──
  if (metadataKnown && (effectiveTitle.length < TITLE_MIN || effectiveTitle.length > TITLE_MAX)) {
    add(
      "title-length",
      "warn",
      "seoTitle",
      `SEO title is ${effectiveTitle.length} characters; aim for ${TITLE_MIN}–${TITLE_MAX}.`,
      effectiveTitle.length < TITLE_MIN
        ? "Write a more descriptive title (or SEO title) — short titles underperform in search results."
        : "Shorten the SEO title — search results truncate around 60 characters.",
    );
  }
  if (metadataKnown && !effectiveDescription) {
    add(
      "description-missing",
      "warn",
      "seoDescription",
      "Post has no meta description (SEO description or excerpt).",
      "Write a 50–160 character description — search engines use it as the result snippet.",
    );
  } else if (metadataKnown && effectiveDescription !== null && (effectiveDescription.length < DESCRIPTION_MIN || effectiveDescription.length > DESCRIPTION_MAX)) {
    add(
      "description-length",
      "warn",
      "seoDescription",
      `Description is ${effectiveDescription.length} characters; aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}.`,
      effectiveDescription.length < DESCRIPTION_MIN
        ? "Expand the description — snippets under 50 characters rarely earn clicks."
        : "Shorten the description — search results truncate around 160 characters.",
    );
  }
  if (metadataKnown && input.slug.length > SLUG_MAX) {
    add(
      "slug-long",
      "warn",
      "slug",
      `Slug is ${input.slug.length} characters; keep it under ${SLUG_MAX}.`,
      "Shorten the slug to the essential words.",
    );
  }
  if (metadataKnown && (/[A-Z]/.test(input.slug) || input.slug.includes("_") || DATE_LIKE_SLUG.test(input.slug))) {
    add(
      "slug-format",
      "warn",
      "slug",
      "Slug contains uppercase letters, underscores, or a date — prefer lowercase words joined by hyphens.",
      "Rename the slug to lowercase hyphenated words without a date prefix.",
    );
  }

  // ── Headings ──
  if (model.headings.some((h) => h.level === 1)) {
    add(
      "h1-in-body",
      "warn",
      "content",
      "Body contains an H1 — the post title already renders as the page H1.",
      "Demote body `#` headings to `##` so the page has a single H1.",
      model.headings.find((h) => h.level === 1)?.position,
    );
  }
  // The title acts as the document's H1, so the first body heading starts at 2.
  let prevLevel = 1;
  for (const heading of model.headings) {
    if (heading.level > prevLevel + 1) {
      add(
        "heading-skip",
        "warn",
        "content",
        `Heading level jumps from H${prevLevel} to H${heading.level} ("${heading.text.trim() || "untitled"}").`,
        `Use H${prevLevel + 1} here or restructure — skipped levels break the document outline.`,
        heading.position,
      );
    }
    prevLevel = heading.level;
  }
  for (const heading of model.headings) {
    if (!heading.text.trim()) {
      add("heading-empty", "warn", "content", "A heading has no text.", "Give the heading text or remove it.", heading.position);
    }
  }
  const seenHeadings = new Set<string>();
  const reportedHeadings = new Set<string>();
  for (const heading of model.headings) {
    const key = normalizeForCompare(heading.text);
    if (!key) continue;
    if (seenHeadings.has(key) && !reportedHeadings.has(key)) {
      reportedHeadings.add(key);
      add(
        "heading-duplicate",
        "warn",
        "content",
        `Heading "${heading.text.trim()}" appears more than once.`,
        "Rename duplicate headings so each section is uniquely identifiable.",
        heading.position,
      );
    }
    seenHeadings.add(key);
  }

  // ── Links ──
  const seenInsecure = new Set<string>();
  const seenBroken = new Set<string>();
  let internalPostLinks = 0;
  for (const ref of model.linkRefs) {
    const raw = ref.raw.trim();
    if (/^http:\/\//i.test(raw) && !seenInsecure.has(raw)) {
      seenInsecure.add(raw);
      add(
        "link-insecure",
        "warn",
        "content",
        `Link uses insecure http:// (${raw}).`,
        "Switch the URL to https://.",
        ref.position,
      );
    }
    const target = linkTarget(raw, base);
    if (!target?.candidate) continue;
    if (target.candidate === input.slug) continue; // self-link resolves once published
    if (published.has(target.candidate) || (target.redirectPath && published.has(target.redirectPath))) {
      internalPostLinks += 1;
    } else if (target.inBlogSpace && !seenBroken.has(target.candidate)) {
      // Candidates outside a subpath site's base path keep their "customer
      // site root" meaning when unpublished — unknowable, never flagged.
      seenBroken.add(target.candidate);
      add(
        "link-internal-broken",
        "error",
        "content",
        `Link to /${target.candidate} has no published post on this site (${raw}).`,
        "Publish or fix the target, or link a full external URL instead.",
        ref.position,
      );
    }
  }
  for (const anchor of model.anchors) {
    const text = normalizeForCompare(anchor.text).replace(/[.!…]+$/, "");
    if (GENERIC_ANCHOR_TEXT[text]) {
      add(
        "link-anchor-generic",
        "warn",
        "content",
        `Link text "${anchor.text.trim()}" doesn't describe the destination.`,
        "Use link text that says where the link goes — search engines and screen readers rely on it.",
        anchor.position,
      );
    }
  }
  if (internalPostLinks === 0) {
    add(
      "link-none-internal",
      "info",
      "content",
      "Post doesn't link to any other published post on this site.",
      "Link at least one related post — internal links help discovery and ranking.",
    );
  }

  // ── Content ──
  if (model.bodyWords.length < THIN_WORDS) {
    add(
      "content-thin",
      "warn",
      "content",
      `Body is ${model.bodyWords.length} words; under ${THIN_WORDS} reads as thin content.`,
      "Add substance — examples, context, or detail — or consolidate this post with a related one.",
    );
  }
  for (const paragraph of model.paragraphs) {
    if (paragraph.words > LONG_PARAGRAPH_WORDS) {
      add(
        "paragraph-long",
        "info",
        "content",
        `A paragraph runs ${paragraph.words} words.`,
        `Split paragraphs over ${LONG_PARAGRAPH_WORDS} words for readability.`,
        paragraph.position,
      );
    }
  }

  // ── AI answers (GEO) ──
  // Answer engines quote short, self-contained passages. These rules are
  // structural only; whether the passage actually answers anything is the
  // writer's judgment (the vibecms-seo skill), not ours.
  if (model.bodyWords.length > 0) {
    if (!model.intro) {
      add(
        "answer-intro-missing",
        "warn",
        "content",
        "The post doesn't open with a paragraph; a heading, list, or quote comes first.",
        "Start with a short paragraph that answers the title directly — AI answers and search snippets quote the opening.",
        model.headings[0]?.position,
      );
    } else if (model.intro.words > INTRO_ANSWER_MAX_WORDS) {
      add(
        "answer-intro-long",
        "info",
        "content",
        `The opening paragraph runs ${model.intro.words} words.`,
        `Keep the opening answer under ${INTRO_ANSWER_MAX_WORDS} words so it can be quoted whole; put the detail in the next paragraph.`,
        model.intro.position,
      );
    }
  }
  for (const paragraph of model.paragraphs) {
    if (paragraph.hasLink) continue;
    const claim = NUMBER_CLAIM.exec(paragraph.prose);
    if (claim) {
      add(
        "answer-claim-unsourced",
        "info",
        "content",
        `A paragraph states "${claim[0].trim()}" with no link to a source.`,
        "Link the source in the same paragraph, or say where the number comes from (your own test, your own data). Never invent a source.",
        paragraph.position,
      );
    }
  }
  model.headings.forEach((heading, index) => {
    const end = model.headings[index + 1]?.textStart ?? model.bodyWords.length;
    const words = end - heading.sectionStart;
    if (words > SECTION_MAX_WORDS) {
      add(
        "answer-section-long",
        "info",
        "content",
        `The section under "${heading.text.trim() || "untitled"}" runs ${words} words without a subheading.`,
        `Break it up with subheadings every ${SECTION_MAX_WORDS} words or fewer, so each part makes sense quoted on its own.`,
        heading.position,
      );
    }
  });
  let stepRun: ParagraphEntry[] = [];
  const flaggedSteps = new Set<ParagraphEntry>();
  const flagSteps = (paragraph: ParagraphEntry) => {
    if (flaggedSteps.has(paragraph)) return;
    flaggedSteps.add(paragraph);
    add(
      "answer-steps-prose",
      "info",
      "content",
      "Steps are written as prose instead of a list.",
      "Turn the steps into a numbered list — readers and AI answers follow and quote lists more reliably than prose.",
      paragraph.position,
    );
  };
  for (const paragraph of model.paragraphs) {
    if (!paragraph.topLevel) continue;
    let markers = 0;
    let ordinal = false;
    for (const match of paragraph.prose.matchAll(STEP_MARKER)) {
      markers += 1;
      if (ORDINAL_MARKER.test(match[1]!.replace(/\s+/g, " "))) ordinal = true;
    }
    if (markers >= STEP_MARKERS_MIN && ordinal) flagSteps(paragraph);
    // Consecutive "Step 1: …", "Step 2: …" paragraphs are a list written long-hand.
    if (STEP_PARAGRAPH.test(paragraph.prose)) {
      stepRun.push(paragraph);
      if (stepRun.length === 2) flagSteps(stepRun[0]!);
    } else {
      stepRun = [];
    }
  }

  // ── Images / social ──
  if (input.renderWarnings !== undefined) {
    // The caller already rendered; map each alt warning to one finding instead
    // of re-inspecting images (render sees resolved/embedded images we don't).
    for (const warning of input.renderWarnings) {
      if (warning === MISSING_IMAGE_ALT_WARNING || renderWarningCode(warning) === RENDER_WARNING.IMAGE_MISSING_ALT) {
        add(
          "image-alt-missing",
          "warn",
          "content",
          "An image is missing alt text.",
          "Add alt text describing the image — required for accessibility and image search.",
        );
      }
    }
  } else {
    for (const image of model.imagesMissingAlt) {
      add(
        "image-alt-missing",
        "warn",
        "content",
        "An image is missing alt text.",
        "Add alt text describing the image — required for accessibility and image search.",
        image.position,
      );
    }
  }
  if (metadataKnown && !input.coverAssetId?.trim()) {
    add(
      "social-image-default",
      "info",
      "coverAssetId",
      "No cover image — the generated social card will be used.",
      "Pick a cover image for a distinctive link preview.",
    );
  }

  // ── Duplicates / canonical / indexing ──
  const normTitle = metadataKnown ? normalizeForCompare(effectiveTitle) : "";
  if (normTitle && input.otherPosts.some((p) => normalizeForCompare(p.title) === normTitle)) {
    add(
      "duplicate-title",
      "warn",
      "seoTitle",
      "Another published post uses this title.",
      "Differentiate the title — duplicates compete with each other in search results.",
    );
  }
  const normDesc = metadataKnown && effectiveDescription ? normalizeForCompare(effectiveDescription) : "";
  if (normDesc && input.otherPosts.some((p) => p.description !== null && normalizeForCompare(p.description) === normDesc)) {
    add(
      "duplicate-description",
      "warn",
      "seoDescription",
      "Another published post uses this description.",
      "Write a distinct description — duplicates weaken every matching snippet.",
    );
  }
  const canonical = input.canonicalUrl?.trim();
  if (metadataKnown && canonical) {
    // Scope is "points off-site" only: malformed canonicals and unknown base
    // URLs are unverifiable, not external — no finding.
    let canonicalParsed: URL | null = null;
    try {
      canonicalParsed = new URL(canonical);
    } catch {
      /* not an absolute URL */
    }
    if (canonicalParsed && base) {
      const onSite =
        canonicalParsed.host === base.url.host &&
        (base.path === "" || canonicalParsed.pathname === base.path || canonicalParsed.pathname.startsWith(`${base.path}/`));
      if (!onSite) {
        add(
          "canonical-external",
          "info",
          "canonicalUrl",
          "Canonical URL points to a different site — this post won't be indexed under its own URL.",
          "Remove the canonical override unless this post is intentionally syndicated from that address.",
        );
      }
    }
  }
  if (!input.site.indexable) {
    add(
      "site-not-indexable",
      "info",
      "site",
      "Site is not indexable — search engines are told to skip every post.",
      "Upgrade/enable indexing for this site when the content should rank.",
    );
  }

  // ── Focus keyword ──
  const keyword = input.focusKeyword ? normalizeKeywordText(input.focusKeyword) : "";
  if (keyword) {
    const has = (text: string) => normalizeKeywordText(text).includes(keyword);
    if (metadataKnown && !has(effectiveTitle)) {
      add("keyword-title", "warn", "seoTitle", `Focus keyword "${keyword}" is missing from the title.`, "Work the focus keyword into the title or SEO title.");
    }
    if (metadataKnown && !has(input.slug)) {
      add("keyword-slug", "warn", "slug", `Focus keyword "${keyword}" is missing from the slug.`, "Include the focus keyword in the slug.");
    }
    // Intro/headings are body checks — they stay live even without metadata.
    if (!has(model.bodyWords.slice(0, INTRO_WORDS).join(" "))) {
      add(
        "keyword-intro",
        "warn",
        "content",
        `Focus keyword "${keyword}" doesn't appear in the first ${INTRO_WORDS} words.`,
        "Mention the focus keyword early — search engines weight the opening.",
      );
    }
    if (!model.headings.some((h) => has(h.text))) {
      add("keyword-heading", "warn", "content", `Focus keyword "${keyword}" doesn't appear in any subheading.`, "Use the focus keyword in at least one subheading (H2–H4); the title doesn't count.");
    }
    if (metadataKnown && (!effectiveDescription || !has(effectiveDescription))) {
      add(
        "keyword-description",
        "warn",
        "seoDescription",
        `Focus keyword "${keyword}" is missing from the description.`,
        "Include the focus keyword in the description.",
      );
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.position ?? -1) - (b.position ?? -1),
  );
  return findings;
}

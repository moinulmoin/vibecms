import { describe, expect, it } from "vitest";

import { MISSING_IMAGE_ALT_WARNING } from "./constants.js";
import { parseSeoMarkdown, tryParseSeoMarkdown } from "./renderer.js";
import {
  collectSeoLinkSlugs,
  seoChecks,
  type SeoCheckInput,
  type SeoFinding,
} from "./seo-checks.js";

// 300 body words split into three ~100-word paragraphs: passes content-thin
// and paragraph-long. Tests that need thin content override the body.
const CHUNK = "word ".repeat(100).trim();
const BODY = `${CHUNK}\n\n${CHUNK}\n\n${CHUNK}`;
// Same, with a published internal link so link-none-internal stays quiet.
const LINKED_BODY = `See [the other post](/other-post) for context.\n\n${BODY}`;

function input(markdown: string, over: Partial<SeoCheckInput> = {}): SeoCheckInput {
  return {
    title: "A well written example post title",
    slug: "example-post",
    seoDescription: "A sufficiently long meta description for this example post.",
    coverAssetId: "asset-1",
    tree: parseSeoMarkdown(markdown),
    site: { indexable: true, primaryBaseUrl: "https://blog.example.com" },
    publishedSlugs: ["other-post"],
    otherPosts: [],
    ...over,
  };
}

const findings = (i: SeoCheckInput) => seoChecks(i);
const codes = (f: SeoFinding[]) => f.map((x) => x.code);
const find = (f: SeoFinding[], code: string) => f.find((x) => x.code === code);

describe("title, description, and slug checks", () => {
  it("passes a clean fixture end to end", () => {
    expect(seoChecks(input(LINKED_BODY))).toEqual([]);
  });

  it("title-length warns under 15 and over 60 chars", () => {
    expect(codes(findings(input(BODY, { seoTitle: "Too short" })))).toContain("title-length");
    expect(codes(findings(input(BODY, { seoTitle: "t".repeat(61) })))).toContain("title-length");
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("title-length");
  });

  it("title-length measures the effective title: seoTitle wins over title", () => {
    // Long seoTitle rescues a short title…
    expect(
      codes(findings(input(LINKED_BODY, { title: "Short", seoTitle: "A well written example post title" }))),
    ).not.toContain("title-length");
    // …and a short seoTitle overrides a fine title.
    expect(codes(findings(input(LINKED_BODY, { seoTitle: "Tiny" })))).toContain("title-length");
    // Blank seoTitle falls back to title.
    expect(codes(findings(input(LINKED_BODY, { seoTitle: "  " })))).not.toContain("title-length");
  });

  it("description-missing warns when neither seoDescription nor excerpt is set", () => {
    const f = findings(input(BODY, { seoDescription: null, excerpt: null }));
    expect(find(f, "description-missing")).toMatchObject({ severity: "warn", field: "seoDescription" });
    expect(codes(f)).not.toContain("description-length");
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("description-missing");
  });

  it("excerpt counts as the description when seoDescription is absent", () => {
    expect(
      codes(findings(input(LINKED_BODY, { seoDescription: null, excerpt: "A sufficiently long meta description for this example post." }))),
    ).not.toContain("description-missing");
    expect(codes(findings(input(LINKED_BODY, { seoDescription: null, excerpt: "Short." })))).toContain("description-length");
  });

  it("description-length warns under 50 and over 160 chars", () => {
    expect(codes(findings(input(BODY, { seoDescription: "Too short." })))).toContain("description-length");
    expect(codes(findings(input(BODY, { seoDescription: "d".repeat(161) })))).toContain("description-length");
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("description-length");
  });

  it("slug-long warns past 75 chars", () => {
    expect(codes(findings(input(BODY, { slug: "s".repeat(76) })))).toContain("slug-long");
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("slug-long");
  });

  it("slug-format warns on uppercase, underscores, and date-like slugs (incl. date prefixes)", () => {
    for (const slug of ["Example-Post", "my_slug", "2024-01-15", "2024-01", "2024", "2026-10-12-topic", "2024-01-review"]) {
      expect(codes(findings(input(BODY, { slug }))), slug).toContain("slug-format");
    }
    for (const slug of ["example-post", "2024-in-review", "v2-api"]) {
      expect(codes(findings(input(LINKED_BODY, { slug }))), slug).not.toContain("slug-format");
    }
  });
});

describe("heading checks", () => {
  it("h1-in-body warns on a Markdown H1 (the title is the page H1)", () => {
    const f = findings(input(`# Body Heading\n\n${BODY}`));
    expect(find(f, "h1-in-body")).toMatchObject({ severity: "warn", field: "content" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("h1-in-body");
  });

  it("heading-skip warns when levels jump (the title counts as H1)", () => {
    expect(codes(findings(input(`### Deep\n\n${BODY}`)))).toContain("heading-skip");
    expect(codes(findings(input(`## A\n\n${CHUNK}\n\n#### C\n\n${CHUNK}\n\n${CHUNK}`)))).toContain("heading-skip");
    expect(codes(findings(input(`## A\n\n${CHUNK}\n\n### B\n\n${CHUNK}\n\n## C\n\n${CHUNK}`)))).not.toContain("heading-skip");
  });

  it("heading-empty warns on a heading with no text", () => {
    expect(codes(findings(input(`##\n\n${BODY}`)))).toContain("heading-empty");
    expect(codes(findings(input(`## Fine\n\n${BODY}`)))).not.toContain("heading-empty");
  });

  it("heading-duplicate warns once per duplicated heading, case-insensitive", () => {
    const f = findings(input(`## Setup\n\n${CHUNK}\n\n## setup\n\n${CHUNK}\n\n${CHUNK}`));
    expect(f.filter((x) => x.code === "heading-duplicate")).toHaveLength(1);
    expect(codes(findings(input(`## Setup\n\n${CHUNK}\n\n## Other\n\n${CHUNK}\n\n${CHUNK}`)))).not.toContain("heading-duplicate");
  });

  it("a leading H1 equal to the post title is not reported — the renderer removes it", () => {
    // Mirrors rehypeRemoveTitleH1: only the first meaningful node counts.
    expect(codes(findings(input(`# A well written example post title\n\n${BODY}`)))).not.toContain("h1-in-body");
    expect(codes(findings(input(`# Another body heading\n\n${BODY}`)))).toContain("h1-in-body");
    // A later H1 — not the leading one — is still flagged.
    expect(codes(findings(input(`${CHUNK}\n\n# A well written example post title\n\n${CHUNK}`)))).toContain("h1-in-body");
  });
});

describe("link checks", () => {
  it("link-internal-broken is an error for root-relative links to unpublished slugs", () => {
    const f = findings(input(`Check [this page](/missing).\n\n${BODY}`));
    const broken = find(f, "link-internal-broken");
    expect(broken).toMatchObject({ severity: "error", field: "content" });
    expect(typeof broken?.position).toBe("number");
    expect(codes(findings(input(`Check [this page](/other-post).\n\n${BODY}`)))).not.toContain("link-internal-broken");
  });

  it("dedupes repeated broken targets and skips self-links", () => {
    const f = findings(input(`[a](/gone) [b](/gone) [c](/gone/sub) [me](/example-post)\n\n${BODY}`));
    expect(f.filter((x) => x.code === "link-internal-broken")).toHaveLength(1);
    expect(codes(f)).not.toContain("link-anchor-generic");
  });

  it("a .md suffix resolves to the same post", () => {
    expect(codes(findings(input(`[md](/other-post.md)\n\n${BODY}`)))).not.toContain("link-internal-broken");
    expect(codes(findings(input(`[md](/other-post.md)\n\n${BODY}`)))).not.toContain("link-none-internal");
  });

  it("checks raw <a href> links and query/hash-stripped targets", () => {
    const f = findings(input(`<a href="/missing?x=1#top">raw</a>\n\n${BODY}`));
    expect(find(f, "link-internal-broken")).toMatchObject({ severity: "error" });
    expect(codes(findings(input(`[q](/other-post?x=1#y)\n\n${BODY}`)))).not.toContain("link-internal-broken");
  });

  it("absolute URLs count as internal only on the site's own host", () => {
    expect(codes(findings(input(`[a](https://blog.example.com/missing)\n\n${BODY}`)))).toContain("link-internal-broken");
    expect(codes(findings(input(`[a](https://other.example/missing)\n\n${BODY}`)))).not.toContain("link-internal-broken");
    expect(codes(findings(input(`[a](//blog.example.com/missing)\n\n${BODY}`)))).not.toContain("link-internal-broken");
  });

  it("base path URLs map onto slugs; unpublished root-relative links outside the base are not flagged", () => {
    const site = { indexable: true, primaryBaseUrl: "https://site.example/blog" };
    expect(codes(findings(input(`[a](/blog/missing)\n\n${BODY}`, { site })))).toContain("link-internal-broken");
    // `/outside` stays a customer-root link (renderer only rewrites published
    // slugs), so an unpublished candidate there is unknowable — not an error.
    expect(codes(findings(input(`[a](/outside)\n\n${BODY}`, { site })))).not.toContain("link-internal-broken");
    // …but once published it is an internal post link.
    const published = findings(input(`[a](/outside)\n\n${BODY}`, { site, publishedSlugs: ["outside"] }));
    expect(codes(published)).not.toContain("link-internal-broken");
    expect(codes(published)).not.toContain("link-none-internal");
  });

  it("reserved and static tenant routes are never broken links", () => {
    const md = `[f](/feed.xml) [d](/docs) [t](/tag/seo) [p](/preview/token-123) [m](/media-assets) [img](/media-assets/abc.png)\n\n${BODY}`;
    const f = findings(input(md));
    expect(codes(f)).not.toContain("link-internal-broken");
  });

  it("generated share-card, asset, feed, and file routes never report broken posts", () => {
    const md = [
      "![card](/og/other-post.png)", // generated /og/[slug].png
      "[card](/og.png) [card2](/og/other-post)",
      "[js](/_astro/index.js)",
      "[feed](/feed.xml) [map](/sitemap.xml) [llms](/llms.txt)",
      "[tag](/tag/seo) [md](/other-post.md) [docs](/docs-search.json)",
    ].join(" ");
    const f = findings(input(`${md}\n\n${BODY}`));
    expect(codes(f)).not.toContain("link-internal-broken");
    // A dotted segment that is not a reserved file is still never a post slug.
    expect(codes(findings(input(`[x](/notes.v1)\n\n${BODY}`)))).not.toContain("link-internal-broken");
  });

  it("link-insecure warns once per http:// URL", () => {
    const f = findings(input(`[a](http://ex.com) [b](http://ex.com) [c](http://ex.org)\n\n${BODY}`));
    expect(f.filter((x) => x.code === "link-insecure")).toHaveLength(2);
    expect(find(f, "link-insecure")).toMatchObject({ severity: "warn" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("link-insecure");
  });

  it("link-anchor-generic warns on nondescriptive anchors", () => {
    const f = findings(input(`[click here](https://ex.com) and [here](https://ex.org)\n\n${BODY}`));
    expect(f.filter((x) => x.code === "link-anchor-generic")).toHaveLength(2);
    const good = `[read the migration guide](https://ex.com)\n\n${BODY}`;
    expect(codes(findings(input(good)))).not.toContain("link-anchor-generic");
  });

  it("link-none-internal is info when no link reaches a published post", () => {
    expect(find(findings(input(BODY)), "link-none-internal")).toMatchObject({ severity: "info" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("link-none-internal");
  });
});

describe("content checks", () => {
  it("content-thin warns under 300 words of prose", () => {
    expect(find(findings(input("Short post.")), "content-thin")).toMatchObject({ severity: "warn" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("content-thin");
  });

  it("content-thin ignores words inside code fences", () => {
    const md = `${CHUNK}\n\n\`\`\`text\n${CHUNK}\n${CHUNK}\n${CHUNK}\n\`\`\`\n\n${CHUNK}`;
    expect(codes(findings(input(md))), "fence words must not pad the count").toContain("content-thin");
  });

  it("paragraph-long is info past 150 words", () => {
    const long = "p ".repeat(160).trim();
    expect(find(findings(input(`${long}\n\n${CHUNK}\n\n${CHUNK}`)), "paragraph-long")).toMatchObject({ severity: "info" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("paragraph-long");
  });

  it("survives a single paragraph with hundreds of thousands of words", () => {
    // Regression: push(...words) overflowed the function-argument limit here.
    const huge = "w ".repeat(200_000).trim();
    const f = findings(input(huge));
    expect(codes(f)).toContain("paragraph-long");
    expect(codes(f)).not.toContain("content-thin");
  });
});

describe("image and social checks", () => {
  it("image-alt-missing warns once per alt-less image when inspecting the tree", () => {
    const f = findings(input(`![](https://cdn.example/a.png)\n\n![alt](https://cdn.example/b.png)\n\n![](https://cdn.example/c.png)\n\n${BODY}`));
    expect(f.filter((x) => x.code === "image-alt-missing")).toHaveLength(2);
    expect(codes(findings(input(`![good](https://cdn.example/b.png)\n\n${LINKED_BODY}`)))).not.toContain("image-alt-missing");
  });

  it("renderWarnings own alt findings: mapped once each, tree not re-inspected", () => {
    const warned = findings(input(`![](https://cdn.example/a.png)\n\n${BODY}`, { renderWarnings: [MISSING_IMAGE_ALT_WARNING, "[[toc]] marker present but no headings were found"] }));
    expect(warned.filter((x) => x.code === "image-alt-missing")).toHaveLength(1);
    // An empty warnings list wins over a missing-alt tree — the caller rendered.
    const owned = findings(input(`![](https://cdn.example/a.png)\n\n${BODY}`, { renderWarnings: [] }));
    expect(owned.filter((x) => x.code === "image-alt-missing")).toHaveLength(0);
  });

  it("social-image-default is info without a cover", () => {
    expect(find(findings(input(BODY, { coverAssetId: null })), "social-image-default")).toMatchObject({
      severity: "info",
      field: "coverAssetId",
    });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("social-image-default");
  });
});

describe("duplicate, canonical, and indexing checks", () => {
  it("duplicate-title compares the effective title against other posts", () => {
    const otherPosts = [{ title: "A well written example post title", description: null }];
    expect(codes(findings(input(BODY, { otherPosts })))).toContain("duplicate-title");
    // seoTitle is what's published as the title — it drives the comparison.
    expect(codes(findings(input(BODY, { seoTitle: "A well written example post title", title: "Different title", otherPosts })))).toContain(
      "duplicate-title",
    );
    expect(codes(findings(input(LINKED_BODY, { otherPosts: [{ title: "Unrelated post", description: null }] })))).not.toContain(
      "duplicate-title",
    );
  });

  it("duplicate-description compares the effective description, never null-vs-null", () => {
    const description = "A sufficiently long meta description for this example post.";
    expect(codes(findings(input(BODY, { otherPosts: [{ title: "Other", description }] })))).toContain("duplicate-description");
    const noDesc = findings(input(BODY, { seoDescription: null, excerpt: null, otherPosts: [{ title: "Other", description: null }] }));
    expect(codes(noDesc)).not.toContain("duplicate-description");
    expect(codes(findings(input(LINKED_BODY, { otherPosts: [{ title: "Other", description: "Something else entirely different here." }] })))).not.toContain(
      "duplicate-description",
    );
  });

  it("duplicate detection folds accents and case — Édition matches édition", () => {
    // The compare happens in JS because SQLite lower() leaves non-ASCII alone.
    const unicode = input(BODY, { title: "Édition spéciale", otherPosts: [{ title: "Édition Spéciale", description: null }] });
    expect(codes(findings(unicode))).toContain("duplicate-title");
    const decomposed = input(BODY, {
      title: "Édition spéciale",
      seoDescription: "Le résumé de cet article est ici.".normalize("NFD"),
      otherPosts: [{ title: "Édition spéciale".normalize("NFD"), description: "Le résumé   de cet article est ici." }],
    });
    const f = findings(decomposed);
    expect(codes(f)).toContain("duplicate-title");
    expect(codes(f)).toContain("duplicate-description");
    const distinct = findings(input(LINKED_BODY, { otherPosts: [{ title: "Édition spéciale", description: null }] }));
    expect(codes(distinct)).not.toContain("duplicate-title");
  });

  it("canonical-external is info only when the canonical verifiably points off-site", () => {
    expect(find(findings(input(BODY, { canonicalUrl: "https://other.example/post" })), "canonical-external")).toMatchObject({
      severity: "info",
      field: "canonicalUrl",
    });
    // Unverifiable cases (no configured base, malformed value) produce no finding.
    expect(
      codes(findings(input(BODY, { canonicalUrl: "https://blog.example.com/anywhere", site: { indexable: true, primaryBaseUrl: null } }))),
    ).not.toContain("canonical-external");
    expect(codes(findings(input(BODY, { canonicalUrl: "not a url" })))).not.toContain("canonical-external");
    expect(codes(findings(input(LINKED_BODY, { canonicalUrl: "https://blog.example.com/example-post" })))).not.toContain(
      "canonical-external",
    );
  });

  it("canonical under the site base path is on-site", () => {
    const site = { indexable: true, primaryBaseUrl: "https://site.example/blog" };
    expect(codes(findings(input(LINKED_BODY, { site, canonicalUrl: "https://site.example/blog/example-post" })))).not.toContain(
      "canonical-external",
    );
    expect(codes(findings(input(BODY, { site, canonicalUrl: "https://site.example/elsewhere" })))).toContain("canonical-external");
  });

  it("site-not-indexable is info when indexing is off", () => {
    const site = { indexable: false, primaryBaseUrl: "https://blog.example.com" };
    expect(find(findings(input(BODY, { site })), "site-not-indexable")).toMatchObject({ severity: "info", field: "site" });
    expect(codes(findings(input(LINKED_BODY)))).not.toContain("site-not-indexable");
  });
});

describe("focus keyword checks", () => {
  const KEYWORD_INPUT = (markdown: string, over: Partial<SeoCheckInput> = {}) =>
    input(markdown, {
      title: "The vibe coding field guide",
      slug: "vibe-coding-guide",
      seoDescription: "A sufficiently long vibe coding description for this post.",
      focusKeyword: "vibe coding",
      ...over,
    });

  it("emits no keyword findings when the keyword is everywhere", () => {
    const md = `Vibe coding starts here.\n\n## Vibe coding basics\n\nSee [other](/other-post).\n\n${BODY}`;
    expect(codes(findings(KEYWORD_INPUT(md))).some((c) => c.startsWith("keyword-"))).toBe(false);
  });

  it("warns once per missing keyword location", () => {
    const f = findings(KEYWORD_INPUT(BODY, { title: "A well written example post title", slug: "example-post", seoDescription: "A sufficiently long meta description for this example post." }));
    expect(codes(f)).toEqual(expect.arrayContaining(["keyword-title", "keyword-slug", "keyword-intro", "keyword-heading", "keyword-description"]));
    for (const code of ["keyword-title", "keyword-slug", "keyword-intro", "keyword-heading", "keyword-description"]) {
      expect(find(f, code)).toMatchObject({ severity: "warn" });
    }
  });

  it("hyphenated slug and title match a spaced keyword", () => {
    const f = findings(KEYWORD_INPUT(`vibe coding intro.\n\n## vibe coding\n\n${BODY}`));
    expect(codes(f)).not.toContain("keyword-title");
    expect(codes(f)).not.toContain("keyword-slug");
    expect(codes(f)).not.toContain("keyword-heading");
  });

  it("diacritics fold on both sides: café matches cafe-guide slug and Café title", () => {
    const f = findings(
      KEYWORD_INPUT(`cafe au lait opening.\n\n## cafe basics\n\n${BODY}`, {
        focusKeyword: "café",
        title: "The Café Guide to coffee",
        slug: "cafe-guide",
        seoDescription: "A sufficiently long cafe description for this post.",
      }),
    );
    expect(codes(f).some((c) => c.startsWith("keyword-"))).toBe(false);
    // The reverse direction folds too: an ASCII keyword matches accented text.
    const accented = findings(
      KEYWORD_INPUT(`café opening.\n\n## café basics\n\n${BODY}`, {
        focusKeyword: "cafe",
        title: "The Café Guide to coffee",
        slug: "café-guide",
        seoDescription: "A sufficiently long café description for this post.",
      }),
    );
    expect(codes(accented).some((c) => c.startsWith("keyword-"))).toBe(false);
  });

  it("keyword inside a code fence does not satisfy intro or heading checks", () => {
    const md = `${"w ".repeat(20)}\n\n\`\`\`text\nvibe coding vibe coding\n## vibe coding\n\`\`\`\n\n${CHUNK}\n\n${CHUNK}`;
    const f = findings(KEYWORD_INPUT(md));
    expect(codes(f)).toContain("keyword-intro");
    expect(codes(f)).toContain("keyword-heading");
  });

  it("keyword-description warns even when there is no description to check", () => {
    const f = findings(KEYWORD_INPUT(`vibe coding.\n\n## vibe coding\n\n${BODY}`, { seoDescription: null, excerpt: null }));
    expect(codes(f)).toContain("description-missing");
    expect(codes(f)).toContain("keyword-description");
  });

  it("no focusKeyword means no keyword findings", () => {
    expect(codes(findings(input(BODY))).some((c) => c.startsWith("keyword-"))).toBe(false);
  });
});

describe("code fence immunity and finding order", () => {
  it("code fences never produce link, heading, or keyword findings", () => {
    const md = [
      "```text",
      "# Not a heading",
      "[not-a-link](/nowhere)",
      "http://insecure.example",
      "[click here](/also-nowhere)",
      "```",
      "",
      BODY,
    ].join("\n");
    const f = findings(input(md));
    expect(codes(f)).not.toEqual(expect.arrayContaining(["h1-in-body", "link-internal-broken", "link-insecure", "link-anchor-generic"]));
    expect(collectSeoLinkSlugs(parseSeoMarkdown(md), "https://blog.example.com")).toEqual([]);
  });

  it("findings are sorted severity → code (lexical) → position", () => {
    const md = `Check [this page](/missing) and [click here](https://ex.com).\n\n![](https://cdn.example/a.png)`;
    // thin body, broken link (error), generic anchor + missing alt (warn),
    // no internal links (info); description and cover are set.
    expect(codes(findings(input(md)))).toEqual([
      "link-internal-broken",
      "content-thin",
      "image-alt-missing",
      "link-anchor-generic",
      "link-none-internal",
    ]);
  });

  it("severity ordering and lexical code order hold exactly for the mixed fixture", () => {
    const md = `Check [this page](/missing) and [click here](https://ex.com).\n\n![](https://cdn.example/a.png)`;
    const f = findings(input(md, { seoDescription: null, excerpt: null, coverAssetId: null }));
    expect(f.map((x) => x.severity)).toEqual(["error", "warn", "warn", "warn", "warn", "info", "info"]);
    expect(codes(f)).toEqual([
      "link-internal-broken",
      "content-thin",
      "description-missing",
      "image-alt-missing",
      "link-anchor-generic",
      "link-none-internal",
      "social-image-default",
    ]);
  });

  it("same-code findings order by source position", () => {
    const altless = findings(input(`![](https://cdn.example/first.png)\n\n${BODY}\n\n![](https://cdn.example/last.png)`));
    const positions = altless.filter((x) => x.code === "image-alt-missing").map((x) => x.position ?? -1);
    expect(positions).toHaveLength(2);
    expect(positions[0]!).toBeLessThan(positions[1]!);
  });
});

describe("collectSeoLinkSlugs", () => {
  it("returns normalized candidates: deduped, sorted, .md stripped, media/reserved excluded", () => {
    const tree = parseSeoMarkdown(
      "[a](/hello) [b](/world.md) [c](https://x.test/y) [d](/feed.xml) [t](/tag/seo) [p](/preview/tok) ![i](/media-assets/z) [e](/hello#s) [f](rel) [g](//cdn.example/x)",
    );
    expect(collectSeoLinkSlugs(tree, "https://blog.example.com")).toEqual(["/hello", "/world.md", "hello", "world"]);
  });

  it("strips the base path and handles subpath semantics like the checks", () => {
    const tree = parseSeoMarkdown("[a](/blog/inner) [b](/outside) [c](https://site.example/blog/abs) [d](https://site.example/other)");
    expect(collectSeoLinkSlugs(tree, "https://site.example/blog")).toEqual(["/abs", "/inner", "abs", "inner", "outside"]);
    // Root-relative targets are candidates even without a base URL; absolute
    // URLs need the host to compare against, so both are dropped here.
    expect(collectSeoLinkSlugs(tree, null)).toEqual(["/outside", "outside"]);
  });

  it("collects from raw HTML srcSet and anchor attributes", () => {
    const tree = parseSeoMarkdown(`<a href="/raw-post">x</a>\n\n<img srcset="/p1 1x, /p2 2x" alt="i">`);
    expect(collectSeoLinkSlugs(tree, "https://blog.example.com")).toEqual(["/p1", "/p2", "/raw-post", "p1", "p2", "raw-post"]);
  });
});

describe("parseSeoMarkdown", () => {
  it("parses the same tree the link collector walks: fences stay opaque, raw HTML becomes elements", () => {
    const tree = parseSeoMarkdown("Text [a](/b).\n\n```\n[fake](/no)\n```\n\n<a href=\"/raw\">raw</a>");
    type LooseEl = { tagName?: string; properties?: Record<string, unknown>; children?: readonly LooseEl[] };
    const tags: string[] = [];
    const hrefs: string[] = [];
    const walk = (nodes: readonly LooseEl[]) => {
      for (const n of nodes) {
        if (n.tagName) tags.push(n.tagName);
        if (typeof n.properties?.href === "string") hrefs.push(n.properties.href);
        if (Array.isArray(n.children)) walk(n.children);
      }
    };
    walk(tree.children as readonly LooseEl[]);
    expect(tags).toContain("pre");
    expect(hrefs).toEqual(["/b", "/raw"]); // fence contents never surface
  });

  it("keeps the renderer's nesting guard: deep Markdown throws for parseSeoMarkdown and yields null for tryParseSeoMarkdown", () => {
    const deep = ">".repeat(5000) + " Hi";
    expect(() => parseSeoMarkdown(deep)).toThrow();
    expect(tryParseSeoMarkdown(deep)).toBeNull();
    // Raw HTML re-parse is guarded the same way.
    const rawDeep = "<div>".repeat(2000) + "Hi" + "</div>".repeat(2000);
    expect(tryParseSeoMarkdown(rawDeep)).toBeNull();
    expect(tryParseSeoMarkdown(BODY)).not.toBeNull();
  });
});

describe("metadataKnown", () => {
  it("skips metadata checks but keeps body and site checks when metadata is unknown", () => {
    const f = findings(
      input(`[x](/gone)\n\n${BODY}`, {
        title: "",
        slug: "",
        seoTitle: null,
        seoDescription: null,
        excerpt: null,
        canonicalUrl: "https://other.example/syndicated",
        coverAssetId: null,
        metadataKnown: false,
        otherPosts: [{ title: "A well written example post title", description: "A sufficiently long meta description for this example post." }],
        focusKeyword: "vibe coding",
      }),
    );
    // Metadata checks are skipped rather than reported against stand-ins.
    expect(codes(f)).not.toEqual(
      expect.arrayContaining([
        "title-length", "description-missing", "description-length", "slug-long", "slug-format",
        "social-image-default", "duplicate-title", "duplicate-description", "canonical-external",
        "keyword-title", "keyword-slug", "keyword-description",
      ]),
    );
    // Body and site checks still run.
    expect(codes(f)).toEqual(expect.arrayContaining(["link-internal-broken", "keyword-intro", "keyword-heading"]));
  });
});

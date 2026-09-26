import { describe, expect, it } from "vitest";
import { renderRichContent } from "@vc/content";
import { createMathRenderer } from "@vc/content/math";
import { formatGuideForPreset, GUIDE_VERSION, RENDERER_VERSION } from "./format-guide";
import { RESERVED_POST_SLUGS } from "@vc/config";
import { createPostRequestSchema, updatePostRequestSchema } from "@vc/api-contract";

describe("format guide v4", () => {
  const guide = formatGuideForPreset("minimal");

  it("advertises guide and renderer v4 with a structured syntax list", () => {
    expect(GUIDE_VERSION).toBe("4");
    expect(RENDERER_VERSION).toBe("4");
    expect(guide.guideVersion).toBe("4");
    const ids = guide.syntax?.map((s) => s.id) ?? [];
    for (const id of ["math", "mermaid", "tabs", "code-group", "package-install", "steps", "heading-id", "heading-toc-hide", "code-inline-lang"]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("new-syntax examples render cleanly", () => {
    const start = guide.examples.indexOf("=== Math");
    const end = guide.examples.indexOf("=== Inline HTML");
    const section = guide.examples.slice(start, end).replace(/^=== .*===$/gm, "");
    const result = renderRichContent(section, { math: createMathRenderer() });
    expect(result.warnings).toEqual([]);
  });

  it("explains preset TOC defaults and the explicit off switch", () => {
    expect(guide.examples).toContain("Omitting both controls uses the preset default");
    expect(guide.examples).toContain("presentation.toc: false");
    expect(guide.examples).not.toContain("produces no TOC");
  });

  it("rejects every public root route as a post slug on create and rename", () => {
    for (const slug of RESERVED_POST_SLUGS) {
      // Some root paths contain dots and are rejected by the slug shape as well.
      expect(createPostRequestSchema.safeParse({ title: "Post", slug, contentMarkdown: "Body" }).success).toBe(false);
      expect(updatePostRequestSchema.safeParse({ postId: "p", expectedVersionNumber: 1, slug }).success).toBe(false);
    }
    const reserved = createPostRequestSchema.safeParse({ title: "Post", slug: "docs", contentMarkdown: "Body" });
    expect(reserved.success).toBe(false);
    if (!reserved.success) expect(reserved.error.issues[0]?.message).toBe("That slug is reserved.");
  });
});

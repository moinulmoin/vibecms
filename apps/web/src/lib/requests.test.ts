import { describe, it, expect } from "vitest";
import {
  createPostRequestSchema,
  updatePostRequestSchema,
  previewPostRequestSchema,
} from "@vc/api-contract";

describe("createPostRequestSchema", () => {
  it("accepts all supported optional fields", () => {
    const result = createPostRequestSchema.safeParse({
      title: "Test Post",
      slug: "test-post",
      excerpt: "Test excerpt",
      contentMarkdown: "# Test\n\nContent",
      tags: ["tag1", "tag2"],
      coverAssetId: "asset-123",
      canonicalUrl: "https://example.com/canonical",
      seoTitle: "SEO Title",
      seoDescription: "SEO Description",
      presentation: { layout: "standard", toc: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal required fields", () => {
    const result = createPostRequestSchema.safeParse({
      title: "Test Post",
      slug: "test-post",
      contentMarkdown: "# Test\n\nContent",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null for nullable fields", () => {
    const result = createPostRequestSchema.safeParse({
      title: "Test Post",
      slug: "test-post",
      contentMarkdown: "# Test\n\nContent",
      coverAssetId: null,
      canonicalUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null presentation", () => {
    const result = createPostRequestSchema.safeParse({
      title: "Test Post",
      slug: "test-post",
      contentMarkdown: "# Test\n\nContent",
      presentation: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("updatePostRequestSchema", () => {
  it("accepts all supported optional fields", () => {
    const result = updatePostRequestSchema.safeParse({
      postId: "post-123",
      title: "Updated Title",
      slug: "updated-slug",
      excerpt: "Updated excerpt",
      contentMarkdown: "# Updated\n\nContent",
      tags: ["tag1", "tag2"],
      coverAssetId: "asset-123",
      canonicalUrl: "https://example.com/canonical",
      seoTitle: "SEO Title",
      seoDescription: "SEO Description",
      presentation: { layout: "standard", toc: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts postId only", () => {
    const result = updatePostRequestSchema.safeParse({
      postId: "post-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null for nullable fields", () => {
    const result = updatePostRequestSchema.safeParse({
      postId: "post-123",
      coverAssetId: null,
      canonicalUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null presentation", () => {
    const result = updatePostRequestSchema.safeParse({
      postId: "post-123",
      presentation: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("previewPostRequestSchema", () => {
  it("accepts presentation field", () => {
    const result = previewPostRequestSchema.safeParse({
      contentMarkdown: "# Test\n\nContent",
      presetId: "default",
      presentation: { layout: "standard", toc: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null presentation", () => {
    const result = previewPostRequestSchema.safeParse({
      contentMarkdown: "# Test\n\nContent",
      presentation: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal required fields", () => {
    const result = previewPostRequestSchema.safeParse({
      contentMarkdown: "# Test\n\nContent",
    });
    expect(result.success).toBe(true);
  });
});

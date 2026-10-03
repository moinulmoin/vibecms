import { describe, expect, it } from "vitest";
import { loadPostHighlighter } from "./PublicBlogPages";

describe("loadPostHighlighter", () => {
  it("skips Shiki and KaTeX for posts without code, directives, or math", async () => {
    expect(await loadPostHighlighter("# Title\n\nJust prose with a [link](https://example.com).")).toBeNull();
  });

  it("loads once for posts that need it", async () => {
    const first = await loadPostHighlighter("Intro\n\n```ts\nconst x = 1\n```");
    expect(first).not.toBeNull();
    expect(await loadPostHighlighter("Energy is $E = mc^2$.")).toBe(first);
    expect(await loadPostHighlighter("::: install\nvibecms\n:::")).toBe(first);
  });
});

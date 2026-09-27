import { describe, expect, it } from "vitest";
import * as discovery from "./agent-discovery";
import * as agentPages from "./agent-pages";
import * as preview from "../server/preview";
import * as publicBlog from "../server/public-blog";

// astro check reports helpers used after a frontmatter `return` as unused, and
// a cleanup once removed their imports: Markdown and 404 routes then threw at
// runtime while the build still passed. Catch a called-but-not-imported helper.
const pages = import.meta.glob("../pages/**/*.astro", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const helpers = [discovery, agentPages, preview, publicBlog].flatMap((mod) =>
  Object.entries(mod).filter(([, value]) => typeof value === "function").map(([name]) => name),
);

describe("page frontmatter imports", () => {
  it("imports every helper it calls", () => {
    const missing: string[] = [];
    for (const [file, source] of Object.entries(pages)) {
      const frontmatter = source.split(/^---$/m)[1] ?? "";
      const imports = [...frontmatter.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g)].map((m) => m[1]).join(",");
      for (const name of helpers) {
        if (new RegExp(`\\b${name}\\(`).test(frontmatter) && !new RegExp(`\\b${name}\\b`).test(imports)
          && !new RegExp(`(?:function|const|let)\\s+${name}\\b`).test(frontmatter)) {
          missing.push(`${file}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

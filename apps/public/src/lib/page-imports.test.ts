import { describe, expect, it } from "vitest";
import * as discovery from "./agent-discovery";
import * as agentPages from "./agent-pages";
import * as preview from "../server/preview";
import * as publicBlog from "../server/public-blog";

// astro check reports helpers used after a frontmatter `return` as unused, and
// a cleanup once removed their imports: Markdown and 404 routes then threw at
// runtime while the build still passed. Catch a called-but-not-bound helper.
const pages = import.meta.glob("../pages/**/*.astro", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const helpers = [discovery, agentPages, preview, publicBlog].flatMap((mod) =>
  Object.entries(mod).filter(([, value]) => typeof value === "function").map(([name]) => name),
);

/** Local value bindings from `import { a, b as c }` (type-only imports bind nothing at runtime). */
function importedValues(frontmatter: string): Set<string> {
  const names = new Set<string>();
  for (const [, typeOnly, list] of frontmatter.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from/g)) {
    if (typeOnly) continue;
    for (const entry of list!.split(",").map((part) => part.trim()).filter(Boolean)) {
      if (entry.startsWith("type ")) continue;
      names.add(entry.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return names;
}

function missingHelpers(source: string, names: string[]): string[] {
  // Comments can't bind anything at runtime.
  const frontmatter = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bound = importedValues(frontmatter);
  return names.filter((name) =>
    new RegExp(`\\b${name}\\s*\\(`).test(frontmatter)
    && !bound.has(name)
    && !new RegExp(`(?:function|const|let|var)\\s+${name}\\b`).test(frontmatter));
}

describe("page frontmatter imports", () => {
  it("catches the ways a helper can be called without a runtime binding", () => {
    expect(missingHelpers(`import { other } from "x";\nreturn markdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`return markdownNotFound ();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`import type { markdownNotFound } from "x";\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`import { type markdownNotFound } from "x";\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`import { markdownNotFound as notFound } from "x";\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`// const markdownNotFound = () => null;\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`/* import { markdownNotFound } from "x"; */\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual(["markdownNotFound"]);
    expect(missingHelpers(`import { markdownNotFound } from "x";\nmarkdownNotFound();`, ["markdownNotFound"])).toEqual([]);
  });

  it("every page binds each helper it calls", () => {
    const missing = Object.entries(pages).flatMap(([file, source]) =>
      missingHelpers(source.split(/^---$/m)[1] ?? "", helpers).map((name) => `${file}: ${name}`));
    expect(missing).toEqual([]);
  });
});

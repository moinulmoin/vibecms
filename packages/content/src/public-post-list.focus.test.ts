import { expect, it } from "vitest";
// This package's production tsconfig does not include Node test types.
// @ts-expect-error Node built-in is available to Vitest at runtime.
import { readFileSync } from "node:fs";

it("keeps the shared card focus ring inside the clipped card in every preset", () => {
  const css = readFileSync("src/public-post-list.module.css", "utf8");
  const focus = css.match(/\.postLink:focus-visible::after\s*\{([^}]*)\}/)?.[1];
  expect(focus).toMatch(/outline:\s*2px solid var\(--vc-accent\)/);
  expect(focus).toMatch(/outline-offset:\s*-[1-9]\d*px/);
  expect(css).toMatch(/\.card\s*\{[^}]*overflow:\s*hidden/);
});

import { describe, expect, it } from "vitest";
import { INTERNAL_ROOT_PREFIX, isDirectInternalRootHit } from "./internal-root";
import { appApiDocsUrl, appLoginUrl } from "./landing-links";

describe("internal root rewrite guard", () => {
  it("allows rewritten external root hits", () => {
    expect(isDirectInternalRootHit("/", `${INTERNAL_ROOT_PREFIX}/marketing`)).toBe(false);
    expect(isDirectInternalRootHit("/", `${INTERNAL_ROOT_PREFIX}/tenant`)).toBe(false);
  });

  it("blocks direct internal path hits", () => {
    expect(isDirectInternalRootHit(`${INTERNAL_ROOT_PREFIX}/marketing`, `${INTERNAL_ROOT_PREFIX}/marketing`)).toBe(
      true,
    );
    expect(isDirectInternalRootHit(`${INTERNAL_ROOT_PREFIX}/tenant`, `${INTERNAL_ROOT_PREFIX}/tenant`)).toBe(true);
    expect(isDirectInternalRootHit(INTERNAL_ROOT_PREFIX, `${INTERNAL_ROOT_PREFIX}/marketing`)).toBe(true);
  });
});

describe("landing CTA URLs", () => {
  it("builds app-host login and docs URLs without trailing slash duplication", () => {
    expect(appLoginUrl("https://app.example.com/")).toBe("https://app.example.com/login");
    expect(appApiDocsUrl("https://app.example.com")).toBe("https://app.example.com/api/v1/docs");
  });
});

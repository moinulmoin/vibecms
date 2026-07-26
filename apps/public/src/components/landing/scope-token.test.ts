import { describe, expect, it } from "vitest";
import {
  INITIAL_SCOPES,
  SCOPE_ROWS,
  formatScopeToken,
  type ScopeKey,
} from "./scope-toggle-demo";

describe("formatScopeToken", () => {
  it("joins enabled scope tokens with double spaces", () => {
    expect(formatScopeToken(INITIAL_SCOPES)).toBe(
      "drafts:write  posts:update  posts:publish  media:write",
    );
  });

  it("returns the empty-state label when nothing is granted", () => {
    const none = Object.fromEntries(SCOPE_ROWS.map((row) => [row.key, false])) as Record<
      ScopeKey,
      boolean
    >;
    expect(formatScopeToken(none)).toBe("- no scopes granted -");
  });

  it("includes only currently enabled tokens", () => {
    const scopes = { ...INITIAL_SCOPES, publish: false, billing: true };
    expect(formatScopeToken(scopes)).toBe(
      "drafts:write  posts:update  media:write  billing:write",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  INITIAL_SCOPES,
  SCOPE_ROWS,
  formatScopeToken,
  type ScopeKey,
} from "./scope-toggle-demo";

describe("formatScopeToken", () => {
  it("shows the exact least-privilege Drafter scopes by default", () => {
    expect(formatScopeToken(INITIAL_SCOPES)).toBe(
      "sites:read  posts:read  posts:create  posts:update  assets:write  activity:read",
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
    const scopes = { ...INITIAL_SCOPES, publish: true, media: false };
    expect(formatScopeToken(scopes)).toBe(
      "sites:read  posts:read  posts:create  posts:update  activity:read  posts:publish",
    );
  });
});

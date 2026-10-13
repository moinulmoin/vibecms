import { describe, expect, it } from "vitest";
import { describeSiteChanges } from "./cms";

describe("describeSiteChanges", () => {
  it("names what an agent changed on the site", () => {
    expect(
      describeSiteChanges(
        JSON.stringify({ themeAccent: "rust", themeMode: "dark" }),
        JSON.stringify({ themeAccent: "violet", themeMode: "dark" }),
      ),
    ).toEqual(["Accent “Rust” → “Violet”"]);
    expect(
      describeSiteChanges(JSON.stringify({ theme: "editorial", themeRadius: "sm" }), JSON.stringify({ theme: "product", themeRadius: null })),
    ).toEqual(["Template “Editorial” → “Magazine”", "Corners “sm” → template default"]);
    expect(describeSiteChanges(
      JSON.stringify({ themeChrome: null, themeIndex: "list", themeHeader: "plain" }),
      JSON.stringify({ themeChrome: "sidebar", themeIndex: "grid", themeHeader: "card" }),
    )).toEqual([
      "Navigation template default → “Sidebar”",
      "Home page “List” → “Grid”",
      "Article header “Plain” → “Card”",
    ]);
    expect(
      describeSiteChanges(JSON.stringify({ heading: "Subscribe", enabled: false }), JSON.stringify({ heading: "Get new posts", enabled: true })),
    ).toEqual(["Signup form off → on", "Signup heading “Subscribe” → “Get new posts”"]);
  });

  it("falls back to no lines for old events without snapshots", () => {
    expect(describeSiteChanges(null, null)).toEqual([]);
    expect(describeSiteChanges("not json", "{}")).toEqual([]);
  });
});

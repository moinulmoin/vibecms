import { describe, expect, it } from "vitest";
import {
  buildOgCardModel,
  buildOgCardNode,
  ogCardTextSupported,
  ogCardVersion,
  ogImagePath,
  ogTitleSize,
  oklchToHex,
  type OgCardNode,
} from "./og-card";

const T = 1_758_700_000;
const site = { name: "Field Notes", theme: "minimal", theme_mode: "light", byline_name: null, show_agent_credit: true };
const post = { title: "Why we moved to the edge", slug: "edge", excerpt: "A short story.", published_at: T, updated_at: T };

function texts(node: OgCardNode): string[] {
  if (node.type === "text") return [node.text];
  return (node.children ?? []).flatMap(texts);
}

describe("og card color", () => {
  it("converts OKLCH tokens to sRGB hex", () => {
    expect(oklchToHex("oklch(100% 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0% 0 0)")).toBe("#000000");
    // Default teal accent on light (AA-verified token).
    expect(oklchToHex("oklch(45% 0.11 154)")).toBe("#096638");
  });
});

describe("og card model", () => {
  it("follows the site mode: dark renders dark, light/system render light", () => {
    expect(buildOgCardModel({ ...site, theme_mode: "dark" }, post, "x.test").mode).toBe("dark");
    expect(buildOgCardModel({ ...site, theme_mode: "system" }, post, "x.test").mode).toBe("light");
    const dark = buildOgCardModel({ ...site, theme_mode: "dark", theme_accent: "rust" }, post, "x.test");
    const light = buildOgCardModel({ ...site, theme_mode: "light", theme_accent: "rust" }, post, "x.test");
    expect(dark.colors.accent).not.toBe(light.colors.accent);
  });

  it("uses the template's accent and font when the owner never picked one (matches the blog)", () => {
    const editorial = buildOgCardModel({ ...site, theme: "editorial", theme_accent: null, theme_font: null }, post, "x.test");
    const rust = buildOgCardModel({ ...site, theme: "editorial", theme_accent: "rust", theme_font: "serif" }, post, "x.test");
    expect(editorial.fonts).toEqual(rust.fonts);
    expect(editorial.colors.accent).toBe(rust.colors.accent);
  });

  it("uses the template's heading font", () => {
    expect(buildOgCardModel({ ...site, theme_font: "serif" }, post, "x.test").fonts.heading).toBe("Newsreader");
    expect(buildOgCardModel({ ...site, theme_font: "mono" }, post, "x.test").fonts).toEqual({
      heading: "Geist Mono",
      body: "Geist",
    });
  });

  it("steps the title size down as titles get longer", () => {
    expect(ogTitleSize("Short", false)).toBeGreaterThan(ogTitleSize("x".repeat(60), false));
    expect(ogTitleSize("x".repeat(60), false)).toBeGreaterThan(ogTitleSize("x".repeat(140), false));
    expect(ogTitleSize("Short", true)).toBeLessThan(ogTitleSize("Short", false));
  });

  it("credits the agent only when the byline says so", () => {
    const agent = buildOgCardModel({ ...site, byline_name: "Ada" }, { ...post, published_by_agent: true }, "x.test");
    expect(agent.meta).toContain("Agent-written · reviewed by Ada");
    const off = buildOgCardModel(
      { ...site, byline_name: "Ada", show_agent_credit: false },
      { ...post, published_by_agent: true },
      "x.test",
    );
    expect(off.meta).not.toContain("Agent-written");
    expect(off.meta).toContain("By Ada");
    const human = buildOgCardModel(site, { ...post, published_by_agent: false }, "x.test");
    expect(human.meta).toBe("Sep 24, 2025");
  });

  it("keeps the card free of vibecms branding and drops emoji", () => {
    const node = buildOgCardNode(buildOgCardModel(site, { ...post, title: "Ship it 🚀" }, "fieldnotes.example.com"));
    const all = texts(node).join(" ");
    expect(all).toContain("Ship it");
    expect(all).not.toContain("🚀");
    expect(all.toLowerCase()).not.toContain("vibecms");
    expect(all).toContain("fieldnotes.example.com");
  });

  it("home card shows the site name and description", () => {
    const model = buildOgCardModel({ ...site, description: "Calm essays." }, null, "x.test");
    expect(model.kind).toBe("home");
    expect(model.title).toBe("Field Notes");
    expect(model.description).toBe("Calm essays.");
  });
});

describe("og card version + paths", () => {
  it("is stable for identical inputs and changes with host or content", () => {
    const v = ogCardVersion(site, post, "a.test");
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    expect(ogCardVersion({ ...site }, { ...post }, "A.TEST")).toBe(v);
    expect(ogCardVersion(site, post, "b.test")).not.toBe(v);
    expect(ogCardVersion(site, { ...post, excerpt: "Other" }, "a.test")).not.toBe(v);
    expect(ogCardVersion({ ...site, theme_radius: "lg" }, post, "a.test")).not.toBe(v);
    expect(ogCardVersion(site, null, "a.test")).not.toBe(v);
  });

  it("builds post and home paths", () => {
    expect(ogImagePath("hello-world")).toBe("/og/hello-world.png");
    expect(ogImagePath(null)).toBe("/og.png");
  });

  it("detects titles the card fonts can draw", () => {
    expect(ogCardTextSupported("Über naïve façades — “quotes” 🚀")).toBe(true);
    expect(ogCardTextSupported("日本語のタイトル")).toBe(false);
  });
});

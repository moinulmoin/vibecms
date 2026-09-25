import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// reading.js is a browser IIFE; drive its click handler with minimal fakes.
class FakeElement {
  constructor(private readonly selector: string | null = null) {}
  closest(selector: string) {
    return selector === this.selector ? this : null;
  }
}

const attrs = new Map<string, string>();
const root = {
  getAttribute: (name: string) => attrs.get(name) ?? null,
  setAttribute: (name: string, value: string) => void attrs.set(name, value),
};
let clickListener: ((event: { target: unknown }) => Promise<void> | void) | undefined;
let osDark = false;
const stored = new Map<string, string>();

beforeAll(async () => {
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLButtonElement", class {});
  vi.stubGlobal("document", {
    documentElement: root,
    body: {},
    querySelectorAll: () => [],
    addEventListener: (type: string, listener: typeof clickListener) => {
      if (type === "click") clickListener = listener;
    },
  });
  // The page root's color-scheme is "light dark" for the owner's "system" mode.
  vi.stubGlobal("getComputedStyle", () => ({ colorScheme: "light dark", scrollPaddingTop: "80px" }));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") ? osDark : !osDark }));
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  // @ts-expect-error The browser-only script has no exports; load it for side effects after installing the fakes.
  await import("./scripts/reading.js");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  attrs.clear();
  stored.clear();
});

async function clickToggle() {
  await clickListener?.({ target: new FakeElement("[data-vc-mode-toggle]") });
}

describe("reader light/dark toggle", () => {
  it("flips a system-mode page away from the reader's current OS scheme on the first click", async () => {
    osDark = false;
    await clickToggle();
    expect(attrs.get("data-vc-reader-mode")).toBe("dark");
    expect(stored.get("vc-reader-mode")).toBe("dark");

    attrs.clear();
    osDark = true;
    await clickToggle();
    expect(attrs.get("data-vc-reader-mode")).toBe("light");
  });

  it("flips the owner's forced mode, then the reader's own choice", async () => {
    attrs.set("data-vc-mode", "dark");
    osDark = false;
    await clickToggle();
    expect(attrs.get("data-vc-reader-mode")).toBe("light");
    await clickToggle();
    expect(attrs.get("data-vc-reader-mode")).toBe("dark");
  });

  it("still toggles when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    osDark = false;
    await clickToggle();
    expect(attrs.get("data-vc-reader-mode")).toBe("dark");
  });
});

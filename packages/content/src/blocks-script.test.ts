/**
 * DOM checks for apps/public/src/scripts/blocks.js (the public progressive
 * enhancement for generated blocks), run against real renderer output.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderRichContentToHtml } from "./renderer.js";
// @ts-ignore Vite `?raw` import (this package has no vite/client types).
import BLOCKS_JS_RAW from "../../../apps/public/src/scripts/blocks.js?raw";

const BLOCKS_JS = BLOCKS_JS_RAW as string;

function boot(markdown: string, hash = ""): void {
  document.body.innerHTML = renderRichContentToHtml(markdown);
  history.replaceState(null, "", `/post${hash}`);
  new Function(BLOCKS_JS)();
}

const TABS = "[[toc]]\n\n## Intro\n\n::::tabs\n:::tab[One]\n## First\n:::\n:::tab[Two]\n## Second\n:::\n::::";

function panels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("section.vc-tab")];
}

describe("blocks.js", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // storage unavailable: nothing to reset
    }
  });

  it("opens the tab holding a #fragment target on load", () => {
    boot(TABS, "#h-second");
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);
  });

  it("opens the tab when a TOC link targets a heading in a hidden panel", () => {
    boot(TABS);
    expect(panels().map((p) => p.hidden)).toEqual([false, true]);
    const link = document.querySelector<HTMLAnchorElement>('nav[data-toc] a[href="#h-second"]');
    expect(link).not.toBeNull();
    link!.addEventListener("click", (event) => event.preventDefault());
    link!.click();
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);
  });

  it("opens the tab on hashchange", () => {
    boot(TABS);
    history.replaceState(null, "", "/post#h-second");
    window.dispatchEvent(new Event("hashchange"));
    expect(panels().map((p) => p.hidden)).toEqual([true, false]);
  });

  it("puts tab labels in as text, never markup", () => {
    boot('::::tabs\n:::tab[<img src=x onerror="alert(1)">]\nbody\n:::\n::::');
    const button = document.querySelector<HTMLButtonElement>(".vc-tablist button");
    expect(button?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(document.querySelector(".vc-tablist img")).toBeNull();
  });

  it("is a no-op without generated blocks", () => {
    boot("## Plain\n\ntext", "#h-plain");
    expect(document.querySelector(".vc-tablist")).toBeNull();
    expect(document.querySelector("[data-vc-tabs-ready]")).toBeNull();
  });
});

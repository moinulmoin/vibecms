/**
 * Build-time-bundled Shiki highlighter for fenced code.
 *
 * Kept as its own entry (`@vc/content/highlight`) so surfaces that don't need
 * colored code (API previews, feeds) never pay for the grammars, and the
 * dashboard can lazy-load it. The JavaScript regex engine keeps it runnable on
 * Cloudflare Workers (no WASM), and the synchronous core keeps
 * `renderRichContent` synchronous.
 */
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import vitesseLight from "@shikijs/themes/vitesse-light";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import astro from "@shikijs/langs/astro";
import c from "@shikijs/langs/c";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import docker from "@shikijs/langs/docker";
import elixir from "@shikijs/langs/elixir";
import go from "@shikijs/langs/go";
import graphql from "@shikijs/langs/graphql";
import html from "@shikijs/langs/html";
import http from "@shikijs/langs/http";
import ini from "@shikijs/langs/ini";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import lua from "@shikijs/langs/lua";
import markdown from "@shikijs/langs/markdown";
import nginx from "@shikijs/langs/nginx";
import prisma from "@shikijs/langs/prisma";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import svelte from "@shikijs/langs/svelte";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import vue from "@shikijs/langs/vue";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import zig from "@shikijs/langs/zig";
import type { CodeHighlighter, HighlightedCode } from "./types.js";

export const CODE_THEMES = { light: "vitesse-light", dark: "vitesse-dark" } as const;

let shared: HighlighterCore | null = null;

function core(): HighlighterCore {
  shared ??= createHighlighterCoreSync({
    themes: [vitesseLight, vitesseDark],
    langs: [
      astro, c, css, diff, docker, elixir, go, graphql, html, http, ini, java,
      javascript, json, jsonc, jsx, kotlin, lua, markdown, nginx, prisma, python,
      ruby, rust, shellscript, sql, svelte, toml, tsx, typescript, vue, xml, yaml, zig,
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return shared;
}

/**
 * Returns a highlighter that turns code into Shiki HAST with dual-theme CSS
 * variables (`--shiki-light` / `--shiki-dark`), or null for unknown languages
 * so the renderer falls back to plain text.
 */
export function createCodeHighlighter(): CodeHighlighter {
  const hl = core();
  const loaded = new Set(hl.getLoadedLanguages());
  return {
    supports(lang) {
      return loaded.has(lang);
    },
    highlight(code, lang): HighlightedCode | null {
      if (!loaded.has(lang)) return null;
      const root = hl.codeToHast(code, {
        lang,
        themes: CODE_THEMES,
        defaultColor: false,
        // Long lines (minified bundles, adversarial input) are where grammar
        // regexes blow up; past this they render as one plain token.
        tokenizeMaxLineLength: 160,
      });
      const pre = root.children.find((n) => n.type === "element" && n.tagName === "pre");
      if (!pre || pre.type !== "element") return null;
      const codeEl = pre.children.find((n) => n.type === "element" && n.tagName === "code");
      if (!codeEl || codeEl.type !== "element") return null;
      return { lines: codeEl.children as unknown as HighlightedCode["lines"] };
    },
  };
}

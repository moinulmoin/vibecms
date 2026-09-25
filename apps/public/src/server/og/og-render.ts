/**
 * Share-card rasterizer (Takumi WASM). Only ever loaded through a dynamic
 * `import()` from the `/og/*` routes, so the ~3.8 MB WASM module and the
 * inlined fonts are never evaluated for article/index requests.
 *
 * One Renderer per isolate; fonts register lazily the first time a card needs
 * that family (self-hosted variable woff2 from @vc/ui — no network fetches).
 */
import initTakumi, { Renderer, type Node } from "@takumi-rs/wasm";
// `workerd` export condition → a precompiled WebAssembly.Module (CompiledWasm).
import takumiWasm from "@takumi-rs/wasm/auto";
import {
  buildOgCardNode,
  ogCardFontFamilies,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  type OgCardModel,
  type OgFontFamily,
} from "../../lib/og-card";

// `?inline` gives a base64 data URL, so each font lives in its own lazily
// imported chunk and needs no ASSETS/fetch round trip at render time.
const FONT_SOURCES: Record<OgFontFamily, () => Promise<{ default: string }>> = {
  Geist: () => import("@vc/ui/assets/fonts/Geist-Variable.woff2?inline"),
  "Geist Mono": () => import("@vc/ui/assets/fonts/GeistMono-Variable.woff2?inline"),
  Newsreader: () => import("@vc/ui/assets/fonts/Newsreader-Variable.woff2?inline"),
  "Space Grotesk": () => import("@vc/ui/assets/fonts/SpaceGrotesk-Variable.woff2?inline"),
  "Hanken Grotesk": () => import("@vc/ui/assets/fonts/HankenGrotesk-Variable.woff2?inline"),
};

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let rendererPromise: Promise<Renderer> | null = null;
const registeredFonts = new Map<OgFontFamily, Promise<void>>();

function getRenderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    await initTakumi({ module_or_path: takumiWasm });
    return new Renderer();
  })().catch((error: unknown) => {
    rendererPromise = null;
    throw error;
  });
  return rendererPromise;
}

function ensureFont(renderer: Renderer, family: OgFontFamily): Promise<void> {
  let registered = registeredFonts.get(family);
  if (!registered) {
    registered = (async () => {
      const source = await FONT_SOURCES[family]();
      await renderer.registerFont({ name: family, data: dataUrlBytes(source.default) });
    })().catch((error: unknown) => {
      registeredFonts.delete(family);
      throw error;
    });
    registeredFonts.set(family, registered);
  }
  return registered;
}

/** Render a 1200×630 PNG for a card model. */
export async function renderOgCardPng(model: OgCardModel): Promise<Uint8Array<ArrayBuffer>> {
  const renderer = await getRenderer();
  await Promise.all(ogCardFontFamilies(model).map((family) => ensureFont(renderer, family)));
  return renderer.render(buildOgCardNode(model) as Node, {
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    format: "png",
  });
}

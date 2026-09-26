/** Share-card rasterizer. One renderer per isolate; fonts register on demand. */
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
} from "@vc/content/og-card";

// Wrangler bundles these woff2 files as Data modules (ArrayBuffer), without fetches.
import geist from "@vc/ui/assets/fonts/Geist-Variable.woff2";
import geistMono from "@vc/ui/assets/fonts/GeistMono-Variable.woff2";
import newsreader from "@vc/ui/assets/fonts/Newsreader-Variable.woff2";
import spaceGrotesk from "@vc/ui/assets/fonts/SpaceGrotesk-Variable.woff2";
import hanken from "@vc/ui/assets/fonts/HankenGrotesk-Variable.woff2";

const FONT_SOURCES: Record<OgFontFamily, ArrayBuffer> = {
  Geist: geist,
  "Geist Mono": geistMono,
  Newsreader: newsreader,
  "Space Grotesk": spaceGrotesk,
  "Hanken Grotesk": hanken,
};

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
      await renderer.registerFont({ name: family, data: new Uint8Array(FONT_SOURCES[family]) });
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

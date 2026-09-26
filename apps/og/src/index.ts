import { WorkerEntrypoint } from "cloudflare:workers";
import type { OgCardModel } from "@vc/content/og-card";
import { validateOgCardModel } from "./validation";

/** Named so service bindings can target it with `"entrypoint": "OgWorker"`. */
export class OgWorker extends WorkerEntrypoint {
  async render(input: OgCardModel): Promise<Uint8Array<ArrayBuffer>> {
    const model = validateOgCardModel(input);
    const { renderOgCardPng } = await import("./render");
    return renderOgCardPng(model);
  }
}

export default OgWorker;

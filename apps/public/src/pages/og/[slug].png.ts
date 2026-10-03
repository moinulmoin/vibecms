import type { APIRoute } from "astro";
import { handleOgCardRequest } from "../../server/og/og-route";

/** Generated share card for a published post (see server/og/og-route.ts). */
export const GET: APIRoute = (context) => handleOgCardRequest(context, context.params.slug ?? "");
export const HEAD = GET;

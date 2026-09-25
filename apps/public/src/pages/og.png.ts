import type { APIRoute } from "astro";
import { handleOgCardRequest } from "../server/og/og-route";

/** Generated share card for the blog home (see server/og/og-route.ts). */
export const GET: APIRoute = (context) => handleOgCardRequest(context, undefined);
export const HEAD = GET;

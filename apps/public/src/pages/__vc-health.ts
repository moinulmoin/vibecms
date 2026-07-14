import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  return Response.json({ ok: true, worker: "public" }, { headers: { "cache-control": "no-store" } });
};
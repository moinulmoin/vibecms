import type { APIRoute } from "astro";
import { apiBinding } from "../../server/runtime";

/** Delegates newsletter writes to the API Worker service binding (no TOKEN_PEPPER on public). */
export const POST: APIRoute = async (context) => {
  const url = new URL("/api/subscribe", "https://vibecms-api.internal");
  const forwarded = new Request(url, {
    method: "POST",
    headers: context.request.headers,
    body: context.request.body,
  });
  return apiBinding(context).fetch(forwarded);
};
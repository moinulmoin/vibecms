import type { APIRoute } from "astro";
import { docsSource } from "../lib/docs-source";
import { legalSitemapPages } from "../lib/legal-pages";
import { handleSitemap, type ProductSitemapPage } from "../server/public-feeds";
import { publicLocationRequest } from "../server/public-location";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

// Marketing-host pages beyond `/`: every docs page at its canonical route
// (folder indexes as `/docs/cli`, never `/docs/cli/index`) plus the legal pages.
// Docs carry no revision date, so they omit `<lastmod>`.
const productPages: readonly ProductSitemapPage[] = [
  ...docsSource
    .getPages()
    .map((page) => ({ path: page.url }))
    .sort((a, b) => a.path.localeCompare(b.path)),
  ...legalSitemapPages,
];

export const GET: APIRoute = async (context) => {
  const location = context.locals.publicLocation;
  const request = publicLocationRequest(context.request, location, context.locals.publicPath ?? context.url.pathname);
  return handleSitemap(publicDb(context), request, publicRuntimeEnv(context), location, productPages);
};

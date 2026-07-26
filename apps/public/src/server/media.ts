import { createDataAccess } from "@vc/db";
import {
  type MediaResponsiveWidth,
  parseMediaWidthParam,
} from "../lib/media-assets";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Still-image MIME types the Images binding can safely re-encode. */
const TRANSFORMABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

type NegotiatedFormat = "image/avif" | "image/webp";

function workersDefaultCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  // Workers extend CacheStorage with a `default` cache; DOM lib typings omit it.
  if (!("default" in caches)) return undefined;
  const value = caches.default;
  return value as Cache;
}

export type ServeAssetOptions = {
  request?: Request;
  widthParam?: string | null;
  images?: ImagesBinding;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function originalAssetHeaders(mimeType: string, sizeBytes?: number): Headers {
  const headers = new Headers({
    "content-type": mimeType,
    "cache-control": IMMUTABLE_CACHE_CONTROL,
  });
  if (sizeBytes != null) headers.set("content-length", String(sizeBytes));
  return headers;
}

function bytesResponse(bytes: ArrayBuffer, mimeType: string): Response {
  return new Response(bytes, {
    headers: originalAssetHeaders(mimeType, bytes.byteLength),
  });
}

/** Honor explicit AVIF/WebP quality preferences, breaking ties toward AVIF. */
export function negotiateTransformFormat(acceptHeader: string | null): NegotiatedFormat | null {
  if (!acceptHeader) return null;

  let avifQuality = 0;
  let webpQuality = 0;
  for (const part of acceptHeader.split(",")) {
    const [rawType, ...parameters] = part.split(";");
    const mediaType = rawType?.trim().toLowerCase();
    if (mediaType !== "image/avif" && mediaType !== "image/webp") continue;

    let quality = 1;
    const qualityParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
    if (qualityParameter) {
      const parsed = Number(qualityParameter.trim().slice(2));
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }

    if (mediaType === "image/avif") avifQuality = Math.max(avifQuality, quality);
    else webpQuality = Math.max(webpQuality, quality);
  }

  if (avifQuality <= 0 && webpQuality <= 0) return null;
  return avifQuality >= webpQuality ? "image/avif" : "image/webp";
}

function transformCacheKey(requestUrl: string, width: MediaResponsiveWidth, format: NegotiatedFormat): Request {
  // Cache by the logical variant identity, not the raw Accept header string.
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("w", String(width));
  url.searchParams.set("fmt", format === "image/avif" ? "avif" : "webp");
  return new Request(url.toString(), { method: "GET" });
}

function streamFromBytes(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream();
}

async function serveTransformedAsset(input: {
  bytes: ArrayBuffer;
  images: ImagesBinding;
  width: MediaResponsiveWidth;
  format: NegotiatedFormat;
  requestUrl: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const cache = workersDefaultCache();
  const cacheRequest = transformCacheKey(input.requestUrl, input.width, input.format);

  if (cache) {
    const hit = await cache.match(cacheRequest);
    if (hit) return hit;
  }

  const transformed = await input.images
    .input(streamFromBytes(input.bytes))
    .transform({ width: input.width, fit: "scale-down" })
    .output({ format: input.format });

  const base = transformed.response();
  const headers = new Headers(base.headers);
  headers.set("content-type", transformed.contentType() || input.format);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("vary", "Accept");
  headers.delete("content-length");

  const response = new Response(base.body, {
    status: base.status,
    statusText: base.statusText,
    headers,
  });

  if (cache && response.ok) {
    const put = cache.put(cacheRequest, response.clone());
    if (input.waitUntil) input.waitUntil(put);
    else await put;
  }

  return response;
}

export async function serveAsset(
  db: D1Database,
  bucket: R2Bucket,
  assetId: string,
  options: ServeAssetOptions = {},
) {
  const widthResult = parseMediaWidthParam(options.widthParam ?? null);
  if (widthResult === "invalid") {
    return new Response("Invalid width", { status: 400 });
  }

  const row = await createDataAccess(db).assets.getAssetForServe(assetId);
  if (!row) return new Response("Not found", { status: 404 });

  const object = await bucket.get(row.r2Key);
  if (!object) return new Response("Not found", { status: 404 });

  // Preserve the original no-query contract exactly.
  if (widthResult == null) {
    return new Response(object.body, {
      headers: originalAssetHeaders(row.mimeType, row.sizeBytes),
    });
  }

  const mimeType = row.mimeType.toLowerCase();
  const images = options.images;
  const canTransform = images != null && TRANSFORMABLE_MIME_TYPES.has(mimeType);
  const format = canTransform
    ? negotiateTransformFormat(options.request?.headers.get("accept") ?? null)
    : null;

  // Unsupported/animated types, missing Images binding, or no AVIF/WebP Accept → original.
  if (!images || !canTransform || !format) {
    return new Response(object.body, {
      headers: originalAssetHeaders(row.mimeType, row.sizeBytes),
    });
  }

  const bytes = await object.arrayBuffer();
  try {
    return await serveTransformedAsset({
      bytes,
      images,
      width: widthResult,
      format,
      requestUrl: options.request?.url ?? `https://media.local/media-assets/${assetId}?w=${widthResult}`,
      waitUntil: options.waitUntil,
    });
  } catch {
    // Transform failures must not 500 the public media surface.
    return bytesResponse(bytes, row.mimeType);
  }
}

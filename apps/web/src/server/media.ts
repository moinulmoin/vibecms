import { createAsset, listAssets } from "@vc/core";
import { createD1AssetRepository } from "@vc/db";
import { allowedImageMimeTypes } from "@vc/validators";
import { env } from "cloudflare:workers";
import { getBillingStatusForSite, isSelfHosted } from "./billing";
import type { AppUserContext } from "./onboarding";

type AssetRow = { id: string; site_id: string; r2_key: string; filename: string; mime_type: string; size_bytes: number; alt_text: string | null };

const maxImageBytes = 10 * 1024 * 1024;
const trialMediaBytes = 500 * 1024 * 1024;
const paidMediaBytes = 5 * 1024 * 1024 * 1024;

function repository() {
  return createD1AssetRepository(env.DB);
}

function redirect(to: string) {
  return new Response(null, { status: 303, headers: { Location: to } });
}

function isAllowedMimeType(type: string): type is typeof allowedImageMimeTypes[number] {
  return allowedImageMimeTypes.includes(type as typeof allowedImageMimeTypes[number]);
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180) || "upload";
}

export async function getMedia(app: AppUserContext) {
  return listAssets(repository(), app.actor, app.siteId);
}

export async function uploadAsset(app: AppUserContext, file: File, altText?: string) {
  if (!isAllowedMimeType(file.type)) throw new Error("Only JPEG, PNG, WebP, and GIF images are allowed");
  if (file.size <= 0 || file.size > maxImageBytes) throw new Error("Images must be 10MB or smaller");
  if (!isSelfHosted()) {
    const billingStatus = await getBillingStatusForSite(app.siteId);
    if (billingStatus !== "trialing" && billingStatus !== "active") throw new Error("An active trial or subscription is required to upload media");
    const limit = billingStatus === "trialing" ? trialMediaBytes : paidMediaBytes;
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM assets WHERE site_id = ?").bind(app.siteId).first<{ total: number }>();
    if ((usage?.total ?? 0) + file.size > limit) throw new Error(billingStatus === "trialing" ? "Trial media storage is limited to 500MB" : "Media storage is limited to 5GB");
  }
  const filename = safeFilename(file.name);
  const r2Key = `${app.siteId}/${crypto.randomUUID()}-${filename}`;
  await env.ASSETS_BUCKET.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return createAsset(repository(), app.actor, { siteId: app.siteId, r2Key, filename, mimeType: file.type, sizeBytes: file.size, altText });
}

export async function uploadAssetFromRequest(app: AppUserContext, request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("Missing file", { status: 400 });
  try {
    await uploadAsset(app, file, typeof form.get("altText") === "string" ? String(form.get("altText")) : undefined);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Upload failed", { status: 400 });
  }
  return redirect("/app/media");
}

export async function serveAsset(assetId: string) {
  const row = await env.DB.prepare("SELECT id, site_id, r2_key, filename, mime_type, size_bytes, alt_text FROM assets WHERE id = ? LIMIT 1").bind(assetId).first<AssetRow>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = await env.ASSETS_BUCKET.get(row.r2_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(row.size_bytes),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

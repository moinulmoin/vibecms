import { createAssetInput } from "@vc/validators";
import { ConflictError, NotFoundError } from "../errors";
import { requireScope } from "../policies";
import type { ActivityInput, Actor, Asset } from "../types";

export type AssetRepository = {
  createAsset(input: Omit<Asset, "createdAt" | "updatedAt">, actor: Actor): Promise<Asset>;
  createAssetWithActivity(
    input: Omit<Asset, "createdAt" | "updatedAt">,
    actor: Actor,
    activity: ActivityInput,
  ): Promise<Asset>;
  listAssets(siteId: string): Promise<Asset[]>;
  getAsset(siteId: string, assetId: string): Promise<Asset | null>;
  updateAssetAltText(siteId: string, assetId: string, altText: string | null): Promise<void>;
  deleteAsset(siteId: string, assetId: string): Promise<void>;
  deleteAssetWithActivity(siteId: string, assetId: string, activity: ActivityInput): Promise<void>;
  isAssetReferencedAsCover(siteId: string, assetId: string): Promise<boolean>;
  isAssetReferencedAsSiteSocialImage(siteId: string, assetId: string): Promise<boolean>;
  createActivity(input: ActivityInput): Promise<void>;
};

export async function createAsset(repo: AssetRepository, actor: Actor, input: unknown) {
  requireScope(actor, "assets:write");
  const data = createAssetInput.parse(input);
  const draft = {
    id: crypto.randomUUID(),
    siteId: data.siteId,
    r2Key: data.r2Key,
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    width: data.width ?? null,
    height: data.height ?? null,
    altText: data.altText ?? null,
  };
  const activity: ActivityInput = {
    siteId: draft.siteId,
    actor,
    action: "asset.uploaded",
    entityType: "asset",
    entityId: draft.id,
    summary: `Uploaded ${draft.filename}`,
    after: draft,
  };
  return repo.createAssetWithActivity(draft, actor, activity);
}

export function listAssets(repo: AssetRepository, actor: Actor, siteId: string) {
  requireScope(actor, "assets:write");
  return repo.listAssets(siteId);
}
export async function getAsset(repo: AssetRepository, actor: Actor, siteId: string, assetId: string): Promise<Asset> {
  requireScope(actor, "assets:write");
  const a = await repo.getAsset(siteId, assetId);
  if (!a) throw new NotFoundError("Asset not found");
  return a;
}

export async function updateAssetAltText(
  repo: AssetRepository,
  actor: Actor,
  siteId: string,
  assetId: string,
  altText: string,
): Promise<Asset> {
  requireScope(actor, "assets:write");
  const a = await repo.getAsset(siteId, assetId);
  if (!a) throw new NotFoundError("Asset not found");
  const next = altText.trim().slice(0, 180) || null;
  if (
    !next &&
    ((await repo.isAssetReferencedAsCover(siteId, assetId)) ||
      (await repo.isAssetReferencedAsSiteSocialImage(siteId, assetId)))
  ) {
    throw new ConflictError("Alt text is required while this image is in use");
  }
  await repo.updateAssetAltText(siteId, assetId, next);
  const updated = { ...a, altText: next };
  await repo.createActivity({ siteId, actor, action: "asset.updated", entityType: "asset", entityId: assetId, summary: `Updated alt text for ${a.filename}`, before: a, after: updated });
  return updated;
}

export async function deleteAsset(repo: AssetRepository, actor: Actor, siteId: string, assetId: string): Promise<Asset> {
  requireScope(actor, "assets:write");
  const a = await repo.getAsset(siteId, assetId);
  if (!a) throw new NotFoundError("Asset not found");
  if (
    (await repo.isAssetReferencedAsCover(siteId, assetId)) ||
    (await repo.isAssetReferencedAsSiteSocialImage(siteId, assetId))
  ) {
    throw new ConflictError("Asset is in use");
  }
  await repo.deleteAssetWithActivity(siteId, assetId, {
    siteId,
    actor,
    action: "asset.deleted",
    entityType: "asset",
    entityId: assetId,
    summary: `Deleted ${a.filename}`,
    before: a,
  });
  return a;
}

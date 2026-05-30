import { createAssetInput } from "@vc/validators";
import { requireScope } from "../policies";
import type { ActivityInput, Actor, Asset } from "../types";

export type AssetRepository = {
  createAsset(input: Omit<Asset, "createdAt" | "updatedAt">, actor: Actor): Promise<Asset>;
  listAssets(siteId: string): Promise<Asset[]>;
  getAsset(siteId: string, assetId: string): Promise<Asset | null>;
  createActivity(input: ActivityInput): Promise<void>;
};

export async function createAsset(repo: AssetRepository, actor: Actor, input: unknown) {
  requireScope(actor, "assets:write");
  const data = createAssetInput.parse(input);
  const asset = await repo.createAsset(
    {
      id: crypto.randomUUID(),
      siteId: data.siteId,
      r2Key: data.r2Key,
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      width: null,
      height: null,
      altText: data.altText ?? null,
    },
    actor,
  );
  await repo.createActivity({ siteId: asset.siteId, actor, action: "asset.uploaded", entityType: "asset", entityId: asset.id, summary: `Uploaded ${asset.filename}`, after: asset });
  return asset;
}

export function listAssets(repo: AssetRepository, actor: Actor, siteId: string) {
  requireScope(actor, "assets:write");
  return repo.listAssets(siteId);
}

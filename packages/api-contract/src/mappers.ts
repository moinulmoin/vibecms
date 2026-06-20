import type { Asset, Post, PostSummary, PostVersion, PostVersionSummary } from "@vc/core";
import type { ActivityDto, AssetDto, PostDto, PostSummaryDto, PostVersionDto, PostVersionSummaryDto, SiteDto } from "./dto";

export type SiteRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: number;
  updated_at: number;
};

export type ActivityRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  created_at: number;
};

export function mapSiteRow(row: SiteRow | null): SiteDto | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPostSummary(post: PostSummary): PostSummaryDto {
  const { siteId: _siteId, ...rest } = post;
  return rest;
}

export function mapPost(post: Post): PostDto {
  const { siteId: _siteId, ...rest } = post;
  return rest;
}

export function mapAsset(asset: Asset, url: string): AssetDto {
  const { siteId: _siteId, r2Key: _r2Key, ...rest } = asset;
  return { ...rest, url };
}

export function mapActivityRow(row: ActivityRow): ActivityDto {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

export function mapPostVersionSummary(version: PostVersionSummary): PostVersionSummaryDto {
  return {
    versionNumber: version.versionNumber,
    title: version.title,
    slug: version.slug,
    status: version.status,
    changeSummary: version.changeSummary,
    actorType: version.actorType,
    actorName: version.actorName,
    createdAt: version.createdAt,
  };
}

export function mapPostVersion(version: PostVersion): PostVersionDto {
  return {
    ...mapPostVersionSummary(version),
    excerpt: version.excerpt,
    contentMarkdown: version.contentMarkdown,
    coverAssetId: version.coverAssetId,
    seoTitle: version.seoTitle,
    seoDescription: version.seoDescription,
    tags: version.tags,
    presentation: version.presentation,
  };
}
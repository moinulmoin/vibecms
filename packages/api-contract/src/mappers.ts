import type { Asset, Post, PostSummary, PostVersion, PostVersionSummary } from "@vc/core";
import type { ActivityDto, AssetDto, PostDto, PostSummaryDto, PostVersionDto, PostVersionSummaryDto, SiteDto } from "./dto";

// camelCase input from db.sites.getCurrentSite (kept structural so this contract layer stays free of @vc/db).
type SiteMapperRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  voiceSeedJson: string;
  createdAt: number;
  updatedAt: number;
};

function parseVoiceSeedJson(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type SiteVoiceProfileMapper = {
  audience: string | null;
  voiceSummary: string | null;
  guidelines: Array<{
    kind: "prefer" | "avoid";
    text: string;
    source: { kind: "explicit" } | { kind: "approved_edit"; postId: string; versionNumber: number };
  }>;
  representativePosts: Array<{ id: string; title: string; slug: string; updatedAt: number }>;
  warnings: string[];
  updatedBy: { type: "human"; id: string; name: string };
  createdAt: number;
  updatedAt: number;
};

// camelCase input from db.activity.listBySite (the ActivityEventRow fields projected to ActivityDto).
type ActivityMapperRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actorType: string;
  actorId: string;
  actorName: string;
  createdAt: number;
};

export function mapSiteRow(
  row: SiteMapperRow | null,
  url: string | null,
  voiceProfile: SiteVoiceProfileMapper | null = null,
): SiteDto | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    url,
    voiceSeedUrls: parseVoiceSeedJson(row.voiceSeedJson),
    voiceProfile: voiceProfile
      ? {
          configured: true,
          audience: voiceProfile.audience,
          voiceSummary: voiceProfile.voiceSummary,
          guidelines: voiceProfile.guidelines,
          representativePosts: voiceProfile.representativePosts,
          warnings: voiceProfile.warnings,
          updatedByName: voiceProfile.updatedBy.name,
          createdAt: voiceProfile.createdAt,
          updatedAt: voiceProfile.updatedAt,
        }
      : {
          configured: false,
          audience: null,
          voiceSummary: null,
          guidelines: [],
          representativePosts: [],
          warnings: [],
          updatedByName: null,
          createdAt: null,
          updatedAt: null,
        },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapPostSummary(post: PostSummary, url: string | null): PostSummaryDto {
  const { siteId: _siteId, ...rest } = post;
  return { ...rest, url };
}

export function mapPost(post: Post, url: string | null): PostDto {
  const { siteId: _siteId, ...rest } = post;
  return { ...rest, url };
}

export function mapAsset(asset: Asset, url: string): AssetDto {
  const { siteId: _siteId, r2Key: _r2Key, ...rest } = asset;
  return { ...rest, url };
}

export function mapActivityRow(row: ActivityMapperRow): ActivityDto {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    actorType: row.actorType,
    actorId: row.actorId,
    actorName: row.actorName,
    createdAt: row.createdAt,
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
    canonicalUrl: version.canonicalUrl,
    seoTitle: version.seoTitle,
    seoDescription: version.seoDescription,
    tags: version.tags,
    presentation: version.presentation,
  };
}
import { and, eq, inArray } from "drizzle-orm";
import { createDbClient } from "../client";
import { activityEvents, posts, siteVoiceProfiles, type SiteVoiceProfileRow } from "../schema";

export const VOICE_PROFILE_MAX_GUIDELINES = 12;
export const VOICE_PROFILE_MAX_REPRESENTATIVE_POSTS = 3;

export type VoiceGuidelineSource =
  | { kind: "explicit" }
  | { kind: "approved_edit"; postId: string; versionNumber: number };

export type VoiceGuideline = {
  kind: "prefer" | "avoid";
  text: string;
  source: VoiceGuidelineSource;
};

export type VoiceProfileEditor = {
  type: "human";
  id: string;
  name: string;
};

export type RepresentativePost = {
  id: string;
  title: string;
  slug: string;
  updatedAt: number;
};

export type SiteVoiceProfile = {
  siteId: string;
  audience: string | null;
  voiceSummary: string | null;
  guidelines: VoiceGuideline[];
  representativePostIds: string[];
  representativePosts: RepresentativePost[];
  warnings: string[];
  updatedBy: VoiceProfileEditor;
  createdAt: number;
  updatedAt: number;
};

export type SaveSiteVoiceProfileInput = {
  siteId: string;
  audience: string | null;
  voiceSummary: string | null;
  guidelines: VoiceGuideline[];
  representativePostIds: string[];
  editor: VoiceProfileEditor;
  timestamp: number;
  activityId: string;
};

export type ClearSiteVoiceProfileInput = {
  siteId: string;
  editor: VoiceProfileEditor;
  timestamp: number;
  activityId: string;
};

export class InvalidVoiceProfileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVoiceProfileInputError";
  }
}

export class InvalidVoiceProfileExemplarsError extends Error {
  readonly postIds: string[];

  constructor(postIds: string[]) {
    super("Representative posts must be currently published posts from this site");
    this.name = "InvalidVoiceProfileExemplarsError";
    this.postIds = postIds;
  }
}

function isGuidelineSource(value: unknown): value is VoiceGuidelineSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "explicit") return true;
  return source.kind === "approved_edit"
    && typeof source.postId === "string"
    && source.postId.length > 0
    && source.postId.length <= 120
    && typeof source.versionNumber === "number"
    && Number.isInteger(source.versionNumber)
    && source.versionNumber > 0;
}

function parseGuidelines(json: string): VoiceGuideline[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VoiceGuideline => {
      if (!item || typeof item !== "object") return false;
      const guideline = item as Record<string, unknown>;
      return (guideline.kind === "prefer" || guideline.kind === "avoid")
        && typeof guideline.text === "string"
        && guideline.text.length > 0
        && guideline.text.length <= 200
        && isGuidelineSource(guideline.source);
    }).slice(0, VOICE_PROFILE_MAX_GUIDELINES);
  } catch {
    return [];
  }
}

function parseRepresentativePostIds(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || !item || item.length > 120 || ids.includes(item)) continue;
      ids.push(item);
      if (ids.length === VOICE_PROFILE_MAX_REPRESENTATIVE_POSTS) break;
    }
    return ids;
  } catch {
    return [];
  }
}

function mapStoredProfile(row: SiteVoiceProfileRow) {
  return {
    siteId: row.siteId,
    audience: row.audience,
    voiceSummary: row.voiceSummary,
    guidelines: parseGuidelines(row.guidelinesJson),
    representativePostIds: parseRepresentativePostIds(row.representativePostIdsJson),
    updatedBy: {
      type: "human" as const,
      id: row.updatedById,
      name: row.updatedByName,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function profileSnapshot(profile: {
  audience: string | null;
  voiceSummary: string | null;
  guidelines: VoiceGuideline[];
  representativePostIds: string[];
}) {
  return {
    audience: profile.audience,
    voiceSummary: profile.voiceSummary,
    guidelines: profile.guidelines,
    representativePostIds: profile.representativePostIds,
  };
}

function assertValidInput(input: SaveSiteVoiceProfileInput) {
  if (input.audience !== null && input.audience.length > 300) {
    throw new InvalidVoiceProfileInputError("Audience must be 300 characters or fewer");
  }
  if (input.voiceSummary !== null && input.voiceSummary.length > 500) {
    throw new InvalidVoiceProfileInputError("Voice summary must be 500 characters or fewer");
  }
  if (input.guidelines.length > VOICE_PROFILE_MAX_GUIDELINES) {
    throw new InvalidVoiceProfileInputError(`Use at most ${VOICE_PROFILE_MAX_GUIDELINES} voice rules`);
  }
  for (const guideline of input.guidelines) {
    if ((guideline.kind !== "prefer" && guideline.kind !== "avoid")
      || !guideline.text
      || guideline.text.length > 200
      || !isGuidelineSource(guideline.source)) {
      throw new InvalidVoiceProfileInputError("Voice rules must be non-empty and 200 characters or fewer");
    }
  }
  if (input.representativePostIds.length > VOICE_PROFILE_MAX_REPRESENTATIVE_POSTS
    || new Set(input.representativePostIds).size !== input.representativePostIds.length) {
    throw new InvalidVoiceProfileInputError("Choose up to three unique representative posts");
  }
}

export interface VoiceProfilesRepository {
  getBySite(siteId: string): Promise<SiteVoiceProfile | null>;
  save(input: SaveSiteVoiceProfileInput): Promise<void>;
  clear(input: ClearSiteVoiceProfileInput): Promise<boolean>;
}

export function createVoiceProfilesRepository(db: D1Database): VoiceProfilesRepository {
  const client = createDbClient(db);

  async function getStored(siteId: string) {
    const rows = await client
      .select()
      .from(siteVoiceProfiles)
      .where(eq(siteVoiceProfiles.siteId, siteId))
      .limit(1);
    return rows[0] ? mapStoredProfile(rows[0]) : null;
  }

  return {
    async getBySite(siteId) {
      const profile = await getStored(siteId);
      if (!profile) return null;
      if (profile.representativePostIds.length === 0) {
        return { ...profile, representativePosts: [], warnings: [] };
      }

      const rows = await client
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          status: posts.status,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), inArray(posts.id, profile.representativePostIds)));
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const representativePosts: RepresentativePost[] = [];
      const warnings: string[] = [];
      for (const postId of profile.representativePostIds) {
        const row = rowsById.get(postId);
        if (!row) {
          warnings.push(`Representative post ${postId} is no longer available.`);
        } else if (row.status !== "published") {
          warnings.push(`Representative post ${postId} is no longer published.`);
        } else {
          representativePosts.push({ id: row.id, title: row.title, slug: row.slug, updatedAt: row.updatedAt });
        }
      }
      return { ...profile, representativePosts, warnings };
    },

    async save(input) {
      assertValidInput(input);
      const before = await getStored(input.siteId);
      if (input.representativePostIds.length > 0) {
        const rows = await client
          .select({ id: posts.id })
          .from(posts)
          .where(and(
            eq(posts.siteId, input.siteId),
            eq(posts.status, "published"),
            inArray(posts.id, input.representativePostIds),
          ));
        const validIds = new Set(rows.map((row) => row.id));
        input.representativePostIds = input.representativePostIds.filter((id) => validIds.has(id));
      }

      const after = profileSnapshot(input);
      await client.batch([
        client
          .insert(siteVoiceProfiles)
          .values({
            siteId: input.siteId,
            audience: input.audience,
            voiceSummary: input.voiceSummary,
            guidelinesJson: JSON.stringify(input.guidelines),
            representativePostIdsJson: JSON.stringify(input.representativePostIds),
            updatedByType: input.editor.type,
            updatedById: input.editor.id,
            updatedByName: input.editor.name,
            createdAt: before?.createdAt ?? input.timestamp,
            updatedAt: input.timestamp,
          })
          .onConflictDoUpdate({
            target: siteVoiceProfiles.siteId,
            set: {
              audience: input.audience,
              voiceSummary: input.voiceSummary,
              guidelinesJson: JSON.stringify(input.guidelines),
              representativePostIdsJson: JSON.stringify(input.representativePostIds),
              updatedByType: input.editor.type,
              updatedById: input.editor.id,
              updatedByName: input.editor.name,
              updatedAt: input.timestamp,
            },
          }),
        client.insert(activityEvents).values({
          id: input.activityId,
          siteId: input.siteId,
          actorType: input.editor.type,
          actorId: input.editor.id,
          actorName: input.editor.name,
          action: "site.voice.updated",
          entityType: "site",
          entityId: input.siteId,
          summary: "Updated voice profile",
          beforeJson: before ? JSON.stringify(profileSnapshot(before)) : null,
          afterJson: JSON.stringify(after),
          createdAt: input.timestamp,
        }),
      ]);
    },

    async clear(input) {
      const before = await getStored(input.siteId);
      if (!before) return false;
      await client.batch([
        client.delete(siteVoiceProfiles).where(eq(siteVoiceProfiles.siteId, input.siteId)),
        client.insert(activityEvents).values({
          id: input.activityId,
          siteId: input.siteId,
          actorType: input.editor.type,
          actorId: input.editor.id,
          actorName: input.editor.name,
          action: "site.voice.cleared",
          entityType: "site",
          entityId: input.siteId,
          summary: "Cleared voice profile",
          beforeJson: JSON.stringify(profileSnapshot(before)),
          afterJson: null,
          createdAt: input.timestamp,
        }),
      ]);
      return true;
    },
  };
}

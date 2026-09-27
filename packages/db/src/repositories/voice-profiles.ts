import { and, eq, inArray } from "drizzle-orm";
import { createDbClient } from "../client";
import { posts, siteVoiceProfiles, type SiteVoiceProfileRow } from "../schema";

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
  type: "human" | "api_key" | "agent" | "system";
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
  configured: boolean;
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
  /** Zero means no profile. */
  expectedUpdatedAt: number;
};

export class VoiceProfileConflictError extends Error {
  constructor() {
    super("Voice profile changed since your read. Call sites.get and retry with voiceProfile.revision as expectedUpdatedAt.");
    this.name = "VoiceProfileConflictError";
  }
}

export type ClearSiteVoiceProfileInput = {
  siteId: string;
  expectedUpdatedAt: number;
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
    configured: row.updatedById !== "__voice_profile_cleared__",
    audience: row.audience,
    voiceSummary: row.voiceSummary,
    guidelines: parseGuidelines(row.guidelinesJson),
    representativePostIds: parseRepresentativePostIds(row.representativePostIdsJson),
    updatedBy: {
      type: row.updatedByType,
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
  const redact = (text: string) => text
    .replace(/[^\s"<>]+@[^\s"<>]+/g, "[redacted email]")
    .replace(/\b(?:vc_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted secret]");
  return {
    audience: profile.audience === null ? null : redact(profile.audience),
    voiceSummary: profile.voiceSummary === null ? null : redact(profile.voiceSummary),
    guidelines: profile.guidelines.map((rule) => ({ ...rule, text: redact(rule.text) })),
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
      // One batch: the activity row is written only if the revision matches,
      // and the profile write only if that activity row exists. A stale
      // revision changes nothing; a success always leaves its activity.
      const values = [input.audience, input.voiceSummary, JSON.stringify(input.guidelines),
        JSON.stringify(input.representativePostIds), input.editor.type, input.editor.id,
        input.editor.name];
      const revisionMatches = input.expectedUpdatedAt === 0
        ? "NOT EXISTS (SELECT 1 FROM site_voice_profiles WHERE site_id = ?)"
        : "EXISTS (SELECT 1 FROM site_voice_profiles WHERE site_id = ? AND updated_at = ?)";
      const revisionArgs = input.expectedUpdatedAt === 0 ? [input.siteId] : [input.siteId, input.expectedUpdatedAt];
      const activity = db.prepare(`INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name,
          action, entity_type, entity_id, summary, before_json, after_json, created_at)
          SELECT ?, ?, ?, ?, ?, 'site.voice.updated', 'site', ?, 'Updated the voice profile', ?, ?, ?
          WHERE ${revisionMatches}`)
        .bind(input.activityId, input.siteId, input.editor.type, input.editor.id, input.editor.name,
          input.siteId, before ? JSON.stringify(profileSnapshot(before)) : null, JSON.stringify(after),
          input.timestamp, ...revisionArgs);
      const write = input.expectedUpdatedAt === 0
        ? db.prepare(`INSERT INTO site_voice_profiles (site_id, audience, voice_summary, guidelines_json,
            representative_post_ids_json, updated_by_type, updated_by_id, updated_by_name, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM activity_events WHERE id = ?)
            ON CONFLICT(site_id) DO NOTHING`)
            .bind(input.siteId, ...values, input.timestamp, input.timestamp, input.activityId)
        : db.prepare(`UPDATE site_voice_profiles SET audience = ?, voice_summary = ?, guidelines_json = ?,
            representative_post_ids_json = ?, updated_by_type = ?, updated_by_id = ?, updated_by_name = ?,
            updated_at = max(?, updated_at + 1)
            WHERE site_id = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM activity_events WHERE id = ?)`)
            .bind(...values, input.timestamp, input.siteId, input.expectedUpdatedAt, input.activityId);
      const [, result] = await db.batch([activity, write]);
      if ((result!.meta.changes ?? 0) !== 1) throw new VoiceProfileConflictError();
      return;
    },

    async clear(input) {
      const before = await getStored(input.siteId);
      if (input.expectedUpdatedAt === 0 && !before) return false;
      const [activity, cleared] = await db.batch([
        db.prepare(`INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name,
          action, entity_type, entity_id, summary, before_json, after_json, created_at)
          SELECT ?, ?, ?, ?, ?, 'site.voice.cleared', 'site', ?, 'Cleared voice profile', ?, NULL, ?
          WHERE EXISTS (SELECT 1 FROM site_voice_profiles WHERE site_id = ? AND updated_at = ?)`)
          .bind(input.activityId, input.siteId, input.editor.type, input.editor.id, input.editor.name,
            input.siteId, before ? JSON.stringify(profileSnapshot(before)) : null, input.timestamp,
            input.siteId, input.expectedUpdatedAt),
        db.prepare(`UPDATE site_voice_profiles SET audience = NULL, voice_summary = NULL,
          guidelines_json = '[]', representative_post_ids_json = '[]',
          updated_by_type = 'system', updated_by_id = '__voice_profile_cleared__',
          updated_by_name = '', updated_at = max(?, updated_at + 1)
          WHERE site_id = ? AND updated_at = ?
          AND EXISTS (SELECT 1 FROM activity_events WHERE id = ?)`)
          .bind(input.timestamp, input.siteId, input.expectedUpdatedAt, input.activityId),
      ]);
      if ((activity.meta.changes ?? 0) !== 1 || (cleared.meta.changes ?? 0) !== 1) throw new VoiceProfileConflictError();
      return true;
    },
  };
}

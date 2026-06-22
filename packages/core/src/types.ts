import type { Presentation } from "@vc/config";

export type HumanRole = "owner" | "editor" | "viewer";

export type Scope =
  | "sites:read"
  | "posts:read"
  | "posts:create"
  | "posts:update"
  | "posts:publish"
  | "posts:archive"
  | "assets:write"
  | "activity:read";

export type Actor =
  | { type: "human"; id: string; name: string; role: HumanRole }
  | { type: "api_key"; id: string; name: string; scopes: Scope[] }
  | { type: "agent"; id: string; name: string; scopes: Scope[] }
  | { type: "system"; id: "system"; name: "System" };

export type PostStatus = "draft" | "published" | "archived";
export type BillingStatus = "active" | "past_due" | "canceled" | "unpaid" | "none";

export type Post = {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverAssetId: string | null;
  canonicalUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PostStatus;
  publishedAt: number | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  presentation: Presentation | null;
};
export type PostSummary = Omit<Post, "contentMarkdown" | "seoTitle" | "seoDescription" | "canonicalUrl" | "presentation">;

export type PostVersionSummary = {
  versionNumber: number;
  title: string;
  slug: string;
  status: PostStatus;
  changeSummary: string | null;
  actorType: Actor["type"]; // "human" | "api_key" | "agent" | "system"
  actorName: string;
  createdAt: number;
};
export type PostVersion = PostVersionSummary & {
  excerpt: string | null;
  contentMarkdown: string;
  coverAssetId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  presentation: Presentation | null;
};


export type Asset = {
  id: string;
  siteId: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ActivityInput = {
  siteId: string;
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export const AGENT_TOKEN_PRESETS: Record<"draft" | "publish" | "full", Scope[]> = {
  draft: ["sites:read", "posts:read", "posts:create", "posts:update", "assets:write", "activity:read"],
  publish: ["sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "assets:write", "activity:read"],
  full: ["sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "posts:archive", "assets:write", "activity:read"],
};

// Default scopes for a token minted without an explicit preset: non-destructive publisher (publish, no archive).
export const DEFAULT_SCOPES: Scope[] = AGENT_TOKEN_PRESETS.publish;

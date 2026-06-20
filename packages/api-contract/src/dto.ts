import { z } from "zod";
import { PRESENTATION_LAYOUTS } from "@vc/config";

const presentationSchema = z
  .object({ layout: z.enum(PRESENTATION_LAYOUTS).optional(), toc: z.boolean().optional() })
  .strict()
  .nullable();

export const postStatusSchema = z.enum(["draft", "published", "archived"]);

export const siteDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const postSummaryDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  coverAssetId: z.string().nullable(),
  status: postStatusSchema,
  publishedAt: z.number().nullable(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const postDtoSchema = postSummaryDtoSchema.extend({
  contentMarkdown: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  presentation: presentationSchema,
});

export const assetDtoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  altText: z.string().nullable(),
  url: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const activityDtoSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  summary: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  createdAt: z.number(),
});

export const actorTypeDtoSchema = z.enum(["human", "api_key", "agent", "system"]);

export const postVersionSummaryDtoSchema = z.object({
  versionNumber: z.number().int(),
  title: z.string(),
  slug: z.string(),
  status: postStatusSchema,
  changeSummary: z.string().nullable(),
  actorType: actorTypeDtoSchema,
  actorName: z.string(),
  createdAt: z.number(),
});

export const postVersionDtoSchema = postVersionSummaryDtoSchema.extend({
  excerpt: z.string().nullable(),
  contentMarkdown: z.string(),
  coverAssetId: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  tags: z.array(z.string()),
  presentation: presentationSchema,
});

export type SiteDto = z.infer<typeof siteDtoSchema>;
export type PostSummaryDto = z.infer<typeof postSummaryDtoSchema>;
export type PostDto = z.infer<typeof postDtoSchema>;
export type AssetDto = z.infer<typeof assetDtoSchema>;
export type ActivityDto = z.infer<typeof activityDtoSchema>;
export type PostVersionSummaryDto = z.infer<typeof postVersionSummaryDtoSchema>;
export type PostVersionDto = z.infer<typeof postVersionDtoSchema>;

export const formatGuideDtoSchema = z.object({
  activePresetId: z.string(),
  activePresetName: z.string(),
  guideVersion: z.string(),
  rendererVersion: z.string(),
  recommendedComponents: z.array(z.string()),
  presetGuidance: z.string(),
  examples: z.string(),
  presentationOptions: z.object({
    supportedLayouts: z.array(z.enum(PRESENTATION_LAYOUTS)),
    default: z.object({ layout: z.enum(PRESENTATION_LAYOUTS), toc: z.boolean() }),
    supportsToc: z.boolean(),
    notes: z.string(),
  }),
});

export type FormatGuideDto = z.infer<typeof formatGuideDtoSchema>;

export const previewPostDtoSchema = z.object({
  html: z.string(),
  outline: z.array(z.object({
    depth: z.number(),
    text: z.string(),
    id: z.string(),
  })),
  warnings: z.array(z.string()),
  rendererVersion: z.string(),
  requestedPresentation: presentationSchema,
  resolvedPresentation: z.object({ layout: z.enum(PRESENTATION_LAYOUTS), toc: z.boolean() }),
  presentationWarnings: z.array(z.string()),
});

export type PreviewPostDto = z.infer<typeof previewPostDtoSchema>;
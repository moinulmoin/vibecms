import { z } from "zod";
import { PRESENTATION_LAYOUTS } from "@vc/config";
import {
  DEFAULT_POST_LIST_LIMIT,
  MAX_POST_LIST_LIMIT,
  allowedImageMimeTypes,
  postStatus,
} from "@vc/validators";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");

const titleField = z.string().trim().min(1).max(160);
const excerptField = z.string().trim().max(500);
const seoTitleField = z.string().trim().max(70);
const seoDescriptionField = z.string().trim().max(180);
const contentField = z.string().max(500_000);
const tagsField = z.array(z.string().trim().min(1).max(40)).max(20);
const presentationField = z
  .object({ layout: z.enum(PRESENTATION_LAYOUTS).optional(), toc: z.boolean().optional() })
  .strict()
  .nullable();

export const getSiteRequestSchema = z.object({}).strict();

export const listPostsRequestSchema = z.object({
  status: postStatus.optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_POST_LIST_LIMIT).default(DEFAULT_POST_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export const searchPostsRequestSchema = z.object({
  search: z.string().trim().min(1).max(160),
  limit: z.coerce.number().int().min(1).max(MAX_POST_LIST_LIMIT).default(DEFAULT_POST_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export const getPostRequestSchema = z.object({
  postId: z.string().min(1),
}).strict();

export const createPostRequestSchema = z.object({
  title: titleField,
  slug,
  excerpt: excerptField.optional(),
  contentMarkdown: contentField,
  seoTitle: seoTitleField.optional(),
  seoDescription: seoDescriptionField.optional(),
  tags: tagsField.default([]),
  presentation: presentationField.optional().default(null),
}).strict();

export const updatePostRequestSchema = z.object({
  postId: z.string().min(1),
  title: titleField.optional(),
  slug: slug.optional(),
  excerpt: excerptField.optional(),
  contentMarkdown: contentField.optional(),
  seoTitle: seoTitleField.optional(),
  seoDescription: seoDescriptionField.optional(),
  tags: tagsField.optional(),
  // presentation: undefined = preserve, null = reset to preset default, object = store intent
  presentation: presentationField.optional(),
}).strict();

export const publishPostRequestSchema = z.object({
  postId: z.string().min(1),
}).strict();

export const archivePostRequestSchema = publishPostRequestSchema;

const imageMimeEnum = z.enum(allowedImageMimeTypes);

export const uploadAssetRequestSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: imageMimeEnum,
  dataBase64: z.string().min(1),
  altText: z.string().trim().max(180).optional(),
}).strict();

export const listActivityRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const listPostVersionsRequestSchema = z.object({
  postId: z.string().min(1),
}).strict();

export const getPostVersionRequestSchema = z.object({
  postId: z.string().min(1),
  versionNumber: z.coerce.number().int().min(1),
}).strict();

export const restorePostVersionRequestSchema = z.object({
  postId: z.string().min(1),
  versionNumber: z.coerce.number().int().min(1),
}).strict();

export const getFormatGuideRequestSchema = z.object({
  presetId: z.string().optional(),
}).strict();

export const previewPostRequestSchema = z.object({
  contentMarkdown: contentField,
  presetId: z.string().optional(),
  presentation: presentationField.optional(),
}).strict();

export type GetSiteRequest = z.infer<typeof getSiteRequestSchema>;
export type ListPostsRequest = z.infer<typeof listPostsRequestSchema>;
export type SearchPostsRequest = z.infer<typeof searchPostsRequestSchema>;
export type GetPostRequest = z.infer<typeof getPostRequestSchema>;
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;
export type UpdatePostRequest = z.infer<typeof updatePostRequestSchema>;
export type PublishPostRequest = z.infer<typeof publishPostRequestSchema>;
export type ArchivePostRequest = z.infer<typeof archivePostRequestSchema>;
export type UploadAssetRequest = z.infer<typeof uploadAssetRequestSchema>;
export type ListActivityRequest = z.infer<typeof listActivityRequestSchema>;
export type ListPostVersionsRequest = z.infer<typeof listPostVersionsRequestSchema>;
export type GetPostVersionRequest = z.infer<typeof getPostVersionRequestSchema>;
export type RestorePostVersionRequest = z.infer<typeof restorePostVersionRequestSchema>;
export type GetFormatGuideRequest = z.infer<typeof getFormatGuideRequestSchema>;
export type PreviewPostRequest = z.infer<typeof previewPostRequestSchema>;
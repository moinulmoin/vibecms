import { z } from "zod";
import { PRESENTATION_LAYOUTS } from "@vc/config";
import {
  DEFAULT_POST_LIST_LIMIT,
  MAX_POST_LIST_LIMIT,
  allowedImageMimeTypes,
  isReservedPostSlug,
  postStatus,
  SEO_DESCRIPTION_MAX_LENGTH,
  navLinksSchema,
  socialLinksSchema,
  voiceProfileSettingsInputSchema,
  newsletterSettingsSchema,
  VOICE_PROFILE_MAX_GUIDELINES,
} from "@vc/validators";
import { ACCENT_IDS, BYLINE_NAME_MAX_LENGTH, FONT_IDS, PRESET_IDS, THEME_MODES, THEME_RADII, THEME_WIDTHS } from "@vc/config";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens")
  .refine((value) => !isReservedPostSlug(value), { message: "That slug is reserved." });

const titleField = z.string().trim().min(1).max(160);
const excerptField = z.string().trim().max(500);
const seoTitleField = z.string().trim().max(70);
const seoDescriptionField = z.string().trim().max(SEO_DESCRIPTION_MAX_LENGTH);
const coverAssetIdRequestField = z.string().trim().max(120).nullable();
const canonicalUrlRequestField = z.string().trim().max(2048).nullable();
const contentField = z.string().max(500_000);
const tagsField = z.array(z.string().trim().min(1).max(40)).max(20);
const presentationField = z
  .object({ layout: z.enum(PRESENTATION_LAYOUTS).optional(), toc: z.boolean().optional() })
  .strict()
  .nullable();

export const getSiteRequestSchema = z.object({}).strict();

export const updateSiteRequestSchema = z.object({
  expectedUpdatedAt: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(220).nullable().optional(),
  bylineName: z.string().trim().max(BYLINE_NAME_MAX_LENGTH).nullable().optional(),
  showAgentCredit: z.boolean().optional(),
  defaultSeoTitle: z.string().trim().max(120).optional(),
  defaultSeoDescription: z.string().trim().max(220).nullable().optional(),
  defaultSocialAssetId: z.string().trim().nullable().optional(),
  logoAssetId: z.string().trim().nullable().optional(),
  faviconAssetId: z.string().trim().nullable().optional(),
  navLinks: navLinksSchema.optional(),
  socialLinks: socialLinksSchema.optional(),
}).strict();

export const getThemeRequestSchema = z.object({}).strict();
export const updateThemeRequestSchema = z.object({
  expectedUpdatedAt: z.coerce.number().int().positive(),
  template: z.enum(PRESET_IDS as [string, ...string[]]).optional(),
  keepLook: z.boolean().optional(),
  accent: z.enum(ACCENT_IDS as [string, ...string[]]).optional(),
  font: z.enum(FONT_IDS as [string, ...string[]]).optional(),
  radius: z.enum(THEME_RADII).optional(),
  width: z.enum(THEME_WIDTHS).optional(),
  mode: z.enum(THEME_MODES).optional(),
}).strict();
export const revertThemeRequestSchema = z.object({ expectedUpdatedAt: z.coerce.number().int().positive() }).strict();
export const updateVoiceRequestSchema = z.object({
  audience: voiceProfileSettingsInputSchema.shape.audience,
  tone: voiceProfileSettingsInputSchema.shape.voiceSummary,
  doRules: voiceProfileSettingsInputSchema.shape.preferRules,
  dontRules: voiceProfileSettingsInputSchema.shape.avoidRules,
  representativePostIds: voiceProfileSettingsInputSchema.shape.representativePostIds,
}).strict().refine((value) => value.doRules.length + value.dontRules.length <= VOICE_PROFILE_MAX_GUIDELINES,
  `Use at most ${VOICE_PROFILE_MAX_GUIDELINES} voice rules in total`);
export const updateSignupFormRequestSchema = z.object({
  expectedUpdatedAt: z.coerce.number().int().positive(),
  enabled: newsletterSettingsSchema.shape.enabled.optional(),
  heading: newsletterSettingsSchema.shape.heading.optional(),
  description: newsletterSettingsSchema.shape.subtext.optional(),
  button: newsletterSettingsSchema.shape.buttonLabel.optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 1, 'Send at least one signup form field',
);
export const listTagsRequestSchema = z.object({}).strict();
export const getAnalyticsRequestSchema = z.object({ range: z.enum(['7', '30', '90', '365', 'all']).default('30') }).strict();

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

export const getPostBySlugRequestSchema = z.object({
  slug,
}).strict();

export const createPostRequestSchema = z.object({
  title: titleField,
  slug,
  excerpt: excerptField.optional(),
  contentMarkdown: contentField,
  tags: tagsField.default([]),
  coverAssetId: coverAssetIdRequestField.optional(),
  canonicalUrl: canonicalUrlRequestField.optional(),
  seoTitle: seoTitleField.optional(),
  seoDescription: seoDescriptionField.optional(),
  presentation: presentationField.optional(),
}).strict();

export const updatePostRequestSchema = z.object({
  postId: z.string().min(1),
  expectedVersionNumber: z.coerce.number().int().min(1),
  title: titleField.optional(),
  slug: slug.optional(),
  excerpt: excerptField.optional(),
  contentMarkdown: contentField.optional(),
  tags: tagsField.optional(),
  coverAssetId: coverAssetIdRequestField.optional(),
  canonicalUrl: canonicalUrlRequestField.optional(),
  seoTitle: seoTitleField.optional(),
  seoDescription: seoDescriptionField.optional(),
  presentation: presentationField.optional(),
}).strict();

export const publishPostRequestSchema = z.object({
  postId: z.string().min(1),
  expectedVersionNumber: z.coerce.number().int().min(1),
}).strict();

export const schedulePostRequestSchema = z.object({
  postId: z.string().min(1),
  versionNumber: z.coerce.number().int().min(1),
  publishAt: z.coerce.number().int().positive(),
}).strict();
export const unschedulePostRequestSchema = z.object({ postId: z.string().min(1) }).strict();
export const rotatePostPreviewRequestSchema = z.object({ postId: z.string().min(1) }).strict();

export const archivePostRequestSchema = z.object({
  postId: z.string().min(1),
}).strict();
export const unarchivePostRequestSchema = z.object({ postId: z.string().min(1) }).strict();

const imageMimeEnum = z.enum(allowedImageMimeTypes);

export const uploadAssetRequestSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: imageMimeEnum,
  dataBase64: z.string().min(1),
  altText: z.string().trim().max(180).optional(),
}).strict();

export const listAssetsRequestSchema = z.object({}).strict();
export const getAssetRequestSchema = z.object({ assetId: z.string().min(1) }).strict();
export const deleteAssetRequestSchema = z.object({ assetId: z.string().min(1) }).strict();
export const updateAssetRequestSchema = z.object({ assetId: z.string().min(1), altText: z.string().trim().max(180) }).strict();

export const listActivityRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
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
  expectedVersionNumber: z.coerce.number().int().min(1),
}).strict();
export const previewPostRequestSchema = z.object({
  contentMarkdown: contentField.optional(),
  postId: z.string().min(1).optional(),
  presetId: z.string().optional(),
  presentation: presentationField.optional(),
}).strict().refine((input) => input.postId || input.contentMarkdown !== undefined,
  { message: 'postId or contentMarkdown is required' });

export const getFormatGuideRequestSchema = z.object({
  presetId: z.string().optional(),
}).strict();


export type GetSiteRequest = z.infer<typeof getSiteRequestSchema>;
export type UpdateSiteRequest = z.infer<typeof updateSiteRequestSchema>;
export type UpdateThemeRequest = z.infer<typeof updateThemeRequestSchema>;
export type UpdateVoiceRequest = z.infer<typeof updateVoiceRequestSchema>;
export type ListPostsRequest = z.infer<typeof listPostsRequestSchema>;
export type SearchPostsRequest = z.infer<typeof searchPostsRequestSchema>;
export type GetPostRequest = z.infer<typeof getPostRequestSchema>;
export type GetPostBySlugRequest = z.infer<typeof getPostBySlugRequestSchema>;
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;
export type UpdatePostRequest = z.infer<typeof updatePostRequestSchema>;
export type PublishPostRequest = z.infer<typeof publishPostRequestSchema>;
export type SchedulePostRequest = z.infer<typeof schedulePostRequestSchema>;
export type UnschedulePostRequest = z.infer<typeof unschedulePostRequestSchema>;
export type ArchivePostRequest = z.infer<typeof archivePostRequestSchema>;
export type UnarchivePostRequest = z.infer<typeof unarchivePostRequestSchema>;
export type UploadAssetRequest = z.infer<typeof uploadAssetRequestSchema>;
export type ListActivityRequest = z.infer<typeof listActivityRequestSchema>;
export type ListPostVersionsRequest = z.infer<typeof listPostVersionsRequestSchema>;
export type GetPostVersionRequest = z.infer<typeof getPostVersionRequestSchema>;
export type RestorePostVersionRequest = z.infer<typeof restorePostVersionRequestSchema>;
export type GetFormatGuideRequest = z.infer<typeof getFormatGuideRequestSchema>;
export type PreviewPostRequest = z.infer<typeof previewPostRequestSchema>;
export type ListAssetsRequest = z.infer<typeof listAssetsRequestSchema>;
export type GetAssetRequest = z.infer<typeof getAssetRequestSchema>;
export type DeleteAssetRequest = z.infer<typeof deleteAssetRequestSchema>;
export type UpdateAssetRequest = z.infer<typeof updateAssetRequestSchema>;

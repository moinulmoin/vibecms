import { z } from "zod";
import { PRESENTATION_LAYOUTS } from "@vc/config";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");

export const DEFAULT_POST_LIST_LIMIT = 20;
export const MAX_POST_LIST_LIMIT = 100;


const titleField = z.string().trim().min(1).max(160);
const excerptField = z.string().trim().max(500);
const contentField = z.string().max(500_000);
const coverField = z.string().trim().max(120).nullable();
const canonicalUrlField = z.string().trim().max(2048).nullable();
const tagsField = z.array(z.string().trim().min(1).max(40)).max(20);
const seoTitleField = z.string().trim().max(70);
const seoDescriptionField = z.string().trim().max(180);


// Bounded presentation intent: layout archetype + optional TOC flag.
// null = explicit reset to preset default.
const presentationField = z
  .object({ layout: z.enum(PRESENTATION_LAYOUTS).optional(), toc: z.boolean().optional() })
  .strict()
  .nullable();
export const postStatus = z.enum(["draft", "published", "archived"]);

export const createPostInput = z.object({
  siteId: z.string().min(1),
  title: titleField,
  slug,
  excerpt: excerptField.optional(),
  contentMarkdown: contentField.default(""),
  coverAssetId: coverField.optional(),
  canonicalUrl: canonicalUrlField.optional(),
  tags: tagsField.default([]),
  seoTitle: seoTitleField.optional(),
  seoDescription: seoDescriptionField.optional(),
  presentation: presentationField.optional().default(null),
}).strict();

// Update is a true patch: every field is optional with NO defaults, so an
// omitted field parses to undefined and the command preserves the prior value.
// (createPostInput.partial() would inherit .default(""), wiping unspecified
// contentMarkdown/tags on partial updates.)
export const updatePostInput = z.object({
  siteId: z.string().min(1),
  postId: z.string().min(1),
  title: titleField.optional(),
  slug: slug.optional(),
  excerpt: excerptField.optional(),
  contentMarkdown: contentField.optional(),
  coverAssetId: coverField.optional(),
  tags: tagsField.optional(),
  seoTitle: seoTitleField.optional(),
  canonicalUrl: canonicalUrlField.optional(),
  seoDescription: seoDescriptionField.optional(),
  // presentation: undefined = preserve prior, null = reset to preset default, object = store intent
  presentation: presentationField.optional(),
}).strict();

export const publishPostInput = z.object({
  siteId: z.string().min(1),
  postId: z.string().min(1),
}).strict();

export const archivePostInput = publishPostInput;

export const listPostsInput = z.object({
  siteId: z.string().min(1),
  status: postStatus.optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_POST_LIST_LIMIT).default(DEFAULT_POST_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

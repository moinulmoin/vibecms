import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");

export const DEFAULT_POST_LIST_LIMIT = 20;
export const MAX_POST_LIST_LIMIT = 100;


const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);

export const postStatus = z.enum(["draft", "published", "archived"]);

export const createPostInput = z.object({
  siteId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  slug,
  excerpt: z.string().trim().max(500).optional(),
  contentMarkdown: z.string().max(500_000).default(""),
  coverAssetId: z.string().trim().max(120).nullable().optional(),
  tags: tags.optional(),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(180).optional(),
}).strict();

export const updatePostInput = createPostInput.partial().extend({
  siteId: z.string().min(1),
  postId: z.string().min(1),
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

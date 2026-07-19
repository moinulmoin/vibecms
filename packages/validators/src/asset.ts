import { z } from "zod";

export const allowedImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const createAssetInput = z.object({
  siteId: z.string().min(1),
  r2Key: z.string().min(1).max(400),
  filename: z.string().min(1).max(180),
  mimeType: z.enum(allowedImageMimeTypes),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  altText: z.string().trim().max(180).optional(),
}).strict();

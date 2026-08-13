import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

const docs = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/docs",
  }),
  schema: pageSchema,
});

const meta = defineCollection({
  loader: glob({
    pattern: "**/meta.json",
    base: "./src/content/docs",
  }),
  schema: metaSchema,
});

export const collections = { docs, meta };

import type { Scope } from "@vc/core";
import { MAX_POST_LIST_LIMIT } from "@vc/validators";

export type McpToolDefinition = {
  name: string;
  description: string;
  requiredScope: Scope;
  inputSchema: Record<string, unknown>;
};

const noAdditionalProperties = { additionalProperties: false } as const;
const postStatusEnum = ["draft", "published", "archived"] as const;
const imageMimeEnum = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const postIdProperty = { type: "string", minLength: 1 };
const titleProperty = { type: "string", minLength: 1, maxLength: 160 };
const slugProperty = { type: "string", minLength: 1, maxLength: 120, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const excerptProperty = { type: "string", maxLength: 500 };
const contentMarkdownProperty = { type: "string", maxLength: 500_000 };
const tagsProperty = { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } };
const limitProperty = { type: "integer", minimum: 1, maximum: MAX_POST_LIST_LIMIT, default: 20 };
const offsetProperty = { type: "integer", minimum: 0, maximum: 10_000, default: 0 };

function withScopeDescription(description: string, requiredScope: Scope) {
  return `${description} Requires scope: ${requiredScope}.`;
}

export const mcpTools: McpToolDefinition[] = [
  {
    name: "sites.get",
    requiredScope: "sites:read",
    description: withScopeDescription("Get the current site for this token.", "sites:read"),
    inputSchema: { type: "object", properties: {}, ...noAdditionalProperties },
  },
  {
    name: "posts.list",
    requiredScope: "posts:read",
    description: withScopeDescription("List bounded post summaries for the current site. Use posts.get for full Markdown.", "posts:read"),
    inputSchema: { type: "object", properties: { status: { type: "string", enum: postStatusEnum }, search: { type: "string", maxLength: 160 }, limit: limitProperty, offset: offsetProperty }, ...noAdditionalProperties },
  },
  {
    name: "posts.search",
    requiredScope: "posts:read",
    description: withScopeDescription("Search bounded post summaries by title, slug, or excerpt. Use posts.get for full Markdown.", "posts:read"),
    inputSchema: { type: "object", properties: { search: { type: "string", minLength: 1, maxLength: 160 }, limit: limitProperty, offset: offsetProperty }, required: ["search"], ...noAdditionalProperties },
  },
  {
    name: "posts.get",
    requiredScope: "posts:read",
    description: withScopeDescription("Get one post by id, including full Markdown.", "posts:read"),
    inputSchema: { type: "object", properties: { postId: postIdProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "posts.create",
    requiredScope: "posts:create",
    description: withScopeDescription("Create a draft post.", "posts:create"),
    inputSchema: { type: "object", properties: { title: titleProperty, slug: slugProperty, excerpt: excerptProperty, contentMarkdown: contentMarkdownProperty, tags: tagsProperty }, required: ["title", "slug", "contentMarkdown"], ...noAdditionalProperties },
  },
  {
    name: "posts.update",
    requiredScope: "posts:update",
    description: withScopeDescription("Update a post.", "posts:update"),
    inputSchema: { type: "object", properties: { postId: postIdProperty, title: titleProperty, slug: slugProperty, excerpt: excerptProperty, contentMarkdown: contentMarkdownProperty, tags: tagsProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "posts.publish",
    requiredScope: "posts:publish",
    description: withScopeDescription("Publish a post.", "posts:publish"),
    inputSchema: { type: "object", properties: { postId: postIdProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "posts.archive",
    requiredScope: "posts:archive",
    description: withScopeDescription("Archive a post.", "posts:archive"),
    inputSchema: { type: "object", properties: { postId: postIdProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "assets.upload",
    requiredScope: "assets:write",
    description: withScopeDescription("Upload an image from base64 data. Decoded image must be 10 MB or smaller.", "assets:write"),
    inputSchema: { type: "object", properties: { filename: { type: "string", minLength: 1, maxLength: 180 }, mimeType: { type: "string", enum: imageMimeEnum }, dataBase64: { type: "string" }, altText: { type: "string", maxLength: 180 } }, required: ["filename", "mimeType", "dataBase64"], ...noAdditionalProperties },
  },
  {
    name: "activity.list",
    requiredScope: "activity:read",
    description: withScopeDescription("List recent activity.", "activity:read"),
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, ...noAdditionalProperties },
  },
];

export const mcpToolNames = mcpTools.map((tool) => tool.name) as Array<typeof mcpTools[number]["name"]>;

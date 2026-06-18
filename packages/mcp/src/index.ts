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
const versionNumberProperty = { type: "integer", minimum: 1 };
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
    description: withScopeDescription("Create a draft post from a Markdown body. Returns the new post id; make it live with posts.publish.", "posts:create"),
    inputSchema: { type: "object", properties: { title: titleProperty, slug: slugProperty, excerpt: excerptProperty, contentMarkdown: contentMarkdownProperty, tags: tagsProperty }, required: ["title", "slug", "contentMarkdown"], ...noAdditionalProperties },
  },
  {
    name: "posts.update",
    requiredScope: "posts:update",
    description: withScopeDescription("Update a post. Provide postId plus only the fields to change; contentMarkdown is the full Markdown body.", "posts:update"),
    inputSchema: { type: "object", properties: { postId: postIdProperty, title: titleProperty, slug: slugProperty, excerpt: excerptProperty, contentMarkdown: contentMarkdownProperty, tags: tagsProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "posts.publish",
    requiredScope: "posts:publish",
    description: withScopeDescription("Publish a draft so it appears on the public blog.", "posts:publish"),
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
    description: withScopeDescription("Upload an image from base64 data. Decoded image must be 10 MB or smaller. Returns a URL to reference in your Markdown.", "assets:write"),
    inputSchema: { type: "object", properties: { filename: { type: "string", minLength: 1, maxLength: 180 }, mimeType: { type: "string", enum: imageMimeEnum }, dataBase64: { type: "string" }, altText: { type: "string", maxLength: 180 } }, required: ["filename", "mimeType", "dataBase64"], ...noAdditionalProperties },
  },
  {
    name: "activity.list",
    requiredScope: "activity:read",
    description: withScopeDescription("List recent activity.", "activity:read"),
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, ...noAdditionalProperties },
  },
  {
    name: "posts.versions.list",
    requiredScope: "posts:read",
    description: withScopeDescription("List version history for a post, newest first. Each entry shows versionNumber, actorType, actorName, changeSummary, and status.", "posts:read"),
    inputSchema: { type: "object", properties: { postId: postIdProperty }, required: ["postId"], ...noAdditionalProperties },
  },
  {
    name: "posts.versions.get",
    requiredScope: "posts:read",
    description: withScopeDescription("Get a specific version of a post by versionNumber, including full Markdown content.", "posts:read"),
    inputSchema: { type: "object", properties: { postId: postIdProperty, versionNumber: versionNumberProperty }, required: ["postId", "versionNumber"], ...noAdditionalProperties },
  },
  {
    name: "posts.versions.restore",
    requiredScope: "posts:update",
    description: withScopeDescription("Restore a post to a previous version. Content-only - never re-publishes. Creates a new version + post.restored activity. Returns the updated post.", "posts:update"),
    inputSchema: { type: "object", properties: { postId: postIdProperty, versionNumber: versionNumberProperty }, required: ["postId", "versionNumber"], ...noAdditionalProperties },
  },
];

/**
 * Server-level guidance returned from MCP `initialize`. Clients surface this to
 * the model so an agent learns the post format and the draft->publish flow
 * without trial and error. Keep it in sync with the tool schemas above.
 */
export const mcpInstructions = `VibeCMS is one calm blog shared by a person and their agents. Write posts in Markdown using these tools.

Workflow:
- posts.create makes a draft. Review it, then call posts.publish to make it live. There is no scheduling; publish on demand.
- Edit with posts.update. Hide a live post with posts.archive.

Content rules:
- title: plain text, max 160 characters.
- slug: lowercase words and digits separated by hyphens, max 120, unique. A duplicate slug returns a conflict; choose another slug or update the existing post.
- contentMarkdown: the post body as Markdown.
- excerpt (max 500) and tags (max 20) are optional and improve listings.

Reading: posts.list and posts.search return summaries without the body; use posts.get for the full Markdown.

Images: upload with assets.upload (base64, max 10 MB, jpeg/png/webp/gif), then reference the returned URL in your Markdown.

Version history: posts.versions.list returns all saved versions (newest first) with actorName and changeSummary. posts.versions.get fetches the full Markdown for any version. posts.versions.restore replaces the current content with the chosen version - it is content-only and never re-publishes, and it creates a new version entry marked post.restored. Requires posts:update scope.

Limits and errors: calls share a workspace budget; on a rate-limit error, wait for the reset and retry. When a tool result is marked as an error, read its message and fix your input before retrying (for example, choose a different slug if one is already in use, or correct a field that failed validation).`;

export const mcpToolNames = mcpTools.map((tool) => tool.name) as Array<typeof mcpTools[number]["name"]>;

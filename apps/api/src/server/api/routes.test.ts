import { describe, expect, it } from "vitest";
import { apiV1OperationRoutes, buildOpenApiDocument, getPostBySlugRoute } from "./routes";

describe("by-slug REST contract", () => {
  it("registers the by-slug route before the generic post-id route", () => {
    expect(apiV1OperationRoutes.indexOf(getPostBySlugRoute)).toBeLessThan(
      apiV1OperationRoutes.findIndex((route) => route.path === "/posts/{postId}"),
    );
  });

  it("includes the exact by-slug path and operation in generated OpenAPI", () => {
    const document = buildOpenApiDocument();
    const operation = document.paths?.["/api/v1/posts/by-slug/{slug}"]?.get as
      | { operationId?: string; parameters?: Array<{ name?: string; in?: string }> }
      | undefined;

    expect(operation?.operationId).toBe("getPostBySlug");
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "slug", in: "path" })]),
    );
  });
});

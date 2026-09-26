import { AGENT_TOKEN_PRESETS, DEFAULT_SCOPES } from "@vc/core";
import { describe, expect, it } from "vitest";
import { operationsByToolName } from "./operations";

describe("agent scope contract", () => {
  it("keeps public and destructive mutations out of the least-privilege default", () => {
    expect(DEFAULT_SCOPES).toBe(AGENT_TOKEN_PRESETS.draft);
    expect(AGENT_TOKEN_PRESETS.draft).not.toEqual(
      expect.arrayContaining(["posts:publish", "posts:archive", "assets:delete"]),
    );
    expect(AGENT_TOKEN_PRESETS.publish).not.toEqual(
      expect.arrayContaining(["posts:archive", "assets:delete"]),
    );
    expect(AGENT_TOKEN_PRESETS.full).toEqual(
      expect.arrayContaining(["posts:publish", "posts:archive", "assets:delete"]),
    );
  });

  it("requires the dedicated destructive scope for asset deletion", () => {
    expect(operationsByToolName["assets.delete"].requiredScope).toBe("assets:delete");
  });

  it('exposes scoped unarchive, alt editing, and activity offsets', () => {
    expect(operationsByToolName['posts.unarchive'].requiredScope).toBe('posts:update');
    expect(operationsByToolName['assets.update'].requiredScope).toBe('assets:write');
    expect(operationsByToolName['activity.list'].requestSchema.parse({ offset: 50 })).toMatchObject({ offset: 50 });
  });
});

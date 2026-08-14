import { describe, expect, it } from "vitest";
import { canManageDashboardContent } from "./dashboard-role";

describe("canManageDashboardContent", () => {
  it("keeps viewer sessions read-only", () => {
    expect(canManageDashboardContent("owner")).toBe(true);
    expect(canManageDashboardContent("editor")).toBe(true);
    expect(canManageDashboardContent("viewer")).toBe(false);
    expect(canManageDashboardContent(undefined)).toBe(false);
  });
});

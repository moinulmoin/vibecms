import { describe, expect, it } from "vitest";
import { canManageDashboardContent, canManageDashboardSettings } from "./dashboard-role";

describe("canManageDashboardContent", () => {
  it("keeps viewer sessions read-only", () => {
    expect(canManageDashboardContent("owner")).toBe(true);
    expect(canManageDashboardContent("editor")).toBe(true);
    expect(canManageDashboardContent("viewer")).toBe(false);
    expect(canManageDashboardContent(undefined)).toBe(false);
  });
});

describe("canManageDashboardSettings", () => {
  it("reserves settings changes for the owner", () => {
    expect(canManageDashboardSettings("owner")).toBe(true);
    expect(canManageDashboardSettings("editor")).toBe(false);
    expect(canManageDashboardSettings("viewer")).toBe(false);
    expect(canManageDashboardSettings(undefined)).toBe(false);
  });
});

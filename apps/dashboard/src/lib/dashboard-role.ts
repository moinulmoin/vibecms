import { redirect } from "@tanstack/react-router";
import { emptyPostsListSearch } from "./dashboard-search";
import type { AppRouterContext, AppUserContext } from "../types/dashboard";

export type DashboardRole = AppUserContext["actor"]["role"];

export function canManageDashboardContent(role: DashboardRole | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function requirePostEditorAccess(context: AppRouterContext): void {
  if (!canManageDashboardContent(context.app?.actor.role)) {
    throw redirect({ to: "/dashboard/posts", search: emptyPostsListSearch });
  }
}

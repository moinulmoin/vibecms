import type { Actor } from "@vc/core";
import { normalizeTheme } from "@vc/config";
import { env } from "cloudflare:workers";
import { ensureBillingRow, isSelfHosted } from "./billing";

type AuthSessionUser = { id: string; name: string; email: string };
export type AppUserContext = {
  user: AuthSessionUser;
  siteId: string;
  workspaceId: string;
  actor: Actor;
};
type RoleRow = { role: "owner" | "editor" | "viewer" };
type SiteSetupRow = { name: string; slug: string; description: string | null; default_seo_title: string | null; theme: string };

function now() {
  return Math.floor(Date.now() / 1000);
}

function slugify(input: string) {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42);
  return slug || "site";
}

export async function ensureOnboarding(user: AuthSessionUser): Promise<AppUserContext> {
  const timestamp = now();
  const workspaceId = `workspace_${user.id}`;
  const siteId = `site_${user.id}`;
  const baseSlug = slugify(user.name || user.email.split("@")[0] || user.id);
  const siteSlug = `${baseSlug}-${user.id.slice(0, 8).toLowerCase()}`;

  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(workspaceId, `${user.name || "My"} Workspace`, `workspace-${user.id}`, timestamp, timestamp),
    env.DB.prepare("INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)")
      .bind(`membership_${user.id}`, workspaceId, user.id, timestamp, timestamp),
    env.DB.prepare("INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(siteId, workspaceId, `${user.name || "My"} Blog`, siteSlug, "A clean blog for humans and agents.", timestamp, timestamp),
    env.DB.prepare("INSERT OR IGNORE INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)")
      .bind(`domain_${user.id}`, siteId, `${siteSlug}.localhost`, timestamp, timestamp),
    env.DB.prepare("INSERT OR IGNORE INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, 'system', 'system', 'System', 'site.created', 'site', ?, ?, ?)")
      .bind(`activity_site_created_${user.id}`, siteId, siteId, "Created site during onboarding", timestamp),
  ]);
  await ensureBillingRow(workspaceId, "none");

  const membership = await env.DB.prepare(
    "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1",
  ).bind(workspaceId, user.id).first<RoleRow>();
  const actor: Actor = { type: "human", id: user.id, name: user.name || user.email, role: membership?.role ?? "viewer" };

  return { user, siteId, workspaceId, actor };
}

export async function getSiteSetup(app: AppUserContext) {
  const site = await env.DB.prepare(
    "SELECT name, slug, description, default_seo_title, theme FROM sites WHERE id = ? LIMIT 1",
  ).bind(app.siteId).first<SiteSetupRow>();
  return {
    name: site?.name ?? "My Blog",
    slug: site?.slug ?? "my-blog",
    description: site?.description ?? "",
    theme: normalizeTheme(site?.theme),
    isComplete: Boolean(site?.default_seo_title),
  };
}

export async function completeSiteSetup(app: AppUserContext, request: Request) {
  const form = await request.formData();
  const timestamp = now();
  const nameValue = form.get("name");
  const slugValue = form.get("slug");
  const descriptionValue = form.get("description");
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim().slice(0, 80) : "My Blog";
  const slug = slugify(typeof slugValue === "string" ? slugValue : name).slice(0, 42);
  const description = typeof descriptionValue === "string" && descriptionValue.trim() ? descriptionValue.trim().slice(0, 220) : null;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE sites SET name = ?, slug = ?, description = ?, default_seo_title = ?, default_seo_description = ?, updated_at = ? WHERE id = ?",
    ).bind(name, slug, description, name, description, timestamp, app.siteId),
    env.DB.prepare("UPDATE domains SET hostname = ?, updated_at = ? WHERE site_id = ? AND type = 'default'")
      .bind(`${slug}.localhost`, timestamp, app.siteId),
    env.DB.prepare("INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, 'site.updated', 'site', ?, ?, ?)")
      .bind(`activity_site_setup_${app.user.id}_${timestamp}`, app.siteId, app.actor.type, app.actor.id, app.actor.name, app.siteId, `Configured ${name}`, timestamp),
  ]);

  return new Response(null, { status: 303, headers: { Location: isSelfHosted() ? "/app?ok=setup_complete" : "/app/billing?ok=setup_complete" } });
}

export async function updateSiteTheme(app: AppUserContext, request: Request) {
  const form = await request.formData();
  const value = form.get("theme");
  const theme = normalizeTheme(typeof value === "string" ? value : null);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE sites SET theme = ?, updated_at = ? WHERE id = ?").bind(theme, timestamp, app.siteId),
    env.DB.prepare(
      "INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, 'site.updated', 'site', ?, ?, ?)",
    ).bind(`activity_theme_${app.user.id}_${timestamp}`, app.siteId, app.actor.type, app.actor.id, app.actor.name, app.siteId, `Changed theme to ${theme}`, timestamp),
  ]);
  return new Response(null, { status: 303, headers: { Location: "/app/settings?ok=theme_saved" } });
}

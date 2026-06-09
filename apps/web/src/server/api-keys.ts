import { DEFAULT_SCOPES, type Actor, type Scope } from "@vc/core";
import { env } from "cloudflare:workers";
import type { AppUserContext } from "./onboarding";

type ApiKeyRow = {
  id: string;
  site_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes_json: string;
  actor_name: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

export type ApiKeyListItem = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: Scope[];
  actorName: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

const allScopes: Scope[] = [
  "sites:read",
  "posts:read",
  "posts:create",
  "posts:update",
  "posts:publish",
  "posts:archive",
  "assets:write",
  "activity:read",
];

function now() {
  return Math.floor(Date.now() / 1000);
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const binary = String.fromCharCode(...data);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function tokenHash(token: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TOKEN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
}

function randomToken(envName: "live" | "test" = "test") {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `vc_${envName}_${base64Url(bytes)}`;
}

function parseScopes(form: FormData) {
  const requested = form.getAll("scopes").filter((value): value is Scope => typeof value === "string" && allScopes.includes(value as Scope));
  return requested.length > 0 ? requested : DEFAULT_SCOPES;
}

function mapRow(row: ApiKeyRow): ApiKeyListItem {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes_json) as Scope[],
    actorName: row.actor_name,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export { allScopes };

export async function listApiKeys(app: AppUserContext) {
  const result = await env.DB.prepare(
    `SELECT id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, last_used_at, revoked_at, created_at
     FROM api_keys WHERE site_id = ? ORDER BY created_at DESC`,
  ).bind(app.siteId).all<ApiKeyRow>();
  return result.results.map(mapRow);
}

export async function createApiKeyFromRequest(app: AppUserContext, request: Request) {
  const form = await request.formData();
  const timestamp = now();
  const token = randomToken("test");
  const id = crypto.randomUUID();
  const name = String(form.get("name") || "API token").trim().slice(0, 80) || "API token";
  const actorName = String(form.get("actorName") || name).trim().slice(0, 80) || name;
  const scopes = parseScopes(form);
  await env.DB.prepare(
    `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, app.siteId, name, token.slice(0, 18), await tokenHash(token), JSON.stringify(scopes), actorName, app.user.id, timestamp, timestamp).run();
  await env.DB.prepare(
    `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, 'api_key.created', 'api_key', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), app.siteId, app.actor.type, app.actor.id, app.actor.name, id, `Created API key ${name}`, timestamp).run();
  return { token, id, name, scopes };
}

export async function revokeApiKey(app: AppUserContext, keyId: string) {
  const timestamp = now();
  await env.DB.prepare("UPDATE api_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND site_id = ?")
    .bind(timestamp, timestamp, keyId, app.siteId).run();
  await env.DB.prepare(
    `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, 'api_key.revoked', 'api_key', ?, 'Revoked API key', ?)`,
  ).bind(crypto.randomUUID(), app.siteId, app.actor.type, app.actor.id, app.actor.name, keyId, timestamp).run();
  return new Response(null, { status: 303, headers: { Location: "/app/settings?ok=token_revoked" } });
}

export async function authenticateBearerToken(request: Request): Promise<{ actor: Actor; siteId: string } | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const hash = await tokenHash(token);
  const row = await env.DB.prepare(
    `SELECT id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, last_used_at, revoked_at, created_at
     FROM api_keys WHERE token_hash = ? LIMIT 1`,
  ).bind(hash).first<ApiKeyRow>();
  if (!row || row.revoked_at) return null;
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), row.id).run();
  return {
    siteId: row.site_id,
    actor: { type: "api_key", id: row.id, name: row.actor_name, scopes: JSON.parse(row.scopes_json) as Scope[] },
  };
}

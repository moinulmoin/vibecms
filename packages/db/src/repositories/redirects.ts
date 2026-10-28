import type { Actor } from "@vc/core";

export type SiteRedirect = { fromPath: string; toPath: string; createdAt: number; updatedAt: number };

export async function getSiteRedirect(db: D1Database, siteId: string, fromPath: string): Promise<SiteRedirect | null> {
  return db.prepare(`SELECT from_path AS fromPath, to_path AS toPath, created_at AS createdAt, updated_at AS updatedAt
    FROM site_redirects WHERE site_id = ? AND from_path = ?`).bind(siteId, fromPath).first<SiteRedirect>();
}

export async function listSiteRedirects(db: D1Database, siteId: string, limit: number, offset: number): Promise<SiteRedirect[]> {
  const rows = await db.prepare(`SELECT from_path AS fromPath, to_path AS toPath, created_at AS createdAt, updated_at AS updatedAt
    FROM site_redirects WHERE site_id = ? ORDER BY from_path LIMIT ? OFFSET ?`).bind(siteId, limit, offset).all<SiteRedirect>();
  return rows.results ?? [];
}

export async function countSiteRedirects(db: D1Database, siteId: string): Promise<number> {
  const row = await db.prepare("SELECT count(*) AS total FROM site_redirects WHERE site_id = ?").bind(siteId).first<{ total: number }>();
  return row?.total ?? 0;
}

/** Compare the complete snapshot in the write statement, so concurrent batches cannot invalidate validation. */
export async function setSiteRedirects(
  db: D1Database, siteId: string, actor: Actor, snapshot: SiteRedirect[], changes: { from: string; to: string }[], summary: string,
): Promise<boolean> {
  if (!changes.length) return true;
  const now = Math.floor(Date.now() / 1000);
  const items = changes.map((item) => ({ ...item, id: crypto.randomUUID() }));
  const [result] = await db.batch([
    db.prepare(`INSERT INTO site_redirects (id, site_id, from_path, to_path, created_at, updated_at)
      SELECT json_extract(item.value, '$.id'), ?, json_extract(item.value, '$.from'), json_extract(item.value, '$.to'), ?, ?
      FROM json_each(?) AS item
      WHERE (SELECT count(*) FROM site_redirects WHERE site_id = ?) = json_array_length(?)
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS old
          LEFT JOIN site_redirects AS current ON current.site_id = ? AND current.from_path = json_extract(old.value, '$.fromPath')
          WHERE current.id IS NULL OR current.to_path <> json_extract(old.value, '$.toPath')
            OR current.updated_at <> json_extract(old.value, '$.updatedAt') OR current.created_at <> json_extract(old.value, '$.createdAt')
        )
      ON CONFLICT(site_id, from_path) DO UPDATE SET to_path = excluded.to_path, updated_at = excluded.updated_at`)
      .bind(siteId, now, now, JSON.stringify(items), siteId, JSON.stringify(snapshot), JSON.stringify(snapshot), siteId),
    db.prepare(`INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
      SELECT ?, ?, ?, ?, ?, 'site.redirects.updated', 'site', ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), siteId, actor.type, actor.id, actor.name, siteId, summary, now),
  ]);
  return (result.meta.changes ?? 0) === changes.length;
}

export async function deleteSiteRedirects(db: D1Database, siteId: string, actor: Actor, paths: string[]): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const [result] = await db.batch([
    db.prepare("DELETE FROM site_redirects WHERE site_id = ? AND from_path IN (SELECT value FROM json_each(?))")
      .bind(siteId, JSON.stringify(paths)),
    db.prepare(`INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
      SELECT ?, ?, ?, ?, ?, 'site.redirects.updated', 'site', ?, 'Removed ' || changes() || ' redirects', ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), siteId, actor.type, actor.id, actor.name, siteId, now),
  ]);
  return result.meta.changes ?? 0;
}

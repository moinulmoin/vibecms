/** Only the SHA-256 digest is persisted. The API derives the opaque token from
 * its secret and this random nonce so it can return the same URL after a save. */
export async function hashPreviewToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getPreviewTokenRecord(db: D1Database, siteId: string, postId: string) {
  return db.prepare('SELECT nonce, token_hash AS tokenHash FROM post_preview_tokens WHERE site_id = ? AND post_id = ?')
    .bind(siteId, postId).first<{ nonce: string; tokenHash: string }>();
}

export async function putPreviewTokenRecord(
  db: D1Database, siteId: string, postId: string, nonce: string, tokenHash: string, rotate: boolean,
): Promise<boolean> {
  const statement = rotate
    ? `UPDATE post_preview_tokens SET nonce = ?, token_hash = ?, created_at = ? WHERE site_id = ? AND post_id = ?`
    : `INSERT OR IGNORE INTO post_preview_tokens (nonce, token_hash, created_at, site_id, post_id)
       SELECT ?, ?, ?, site_id, id FROM posts WHERE site_id = ? AND id = ?`;
  const result = await db.prepare(statement).bind(nonce, tokenHash, Math.floor(Date.now() / 1000), siteId, postId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function resolvePreviewToken(db: D1Database, siteId: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await hashPreviewToken(token);
  return db.prepare(`SELECT p.post_id AS postId FROM post_preview_tokens p
    JOIN posts post ON post.id = p.post_id AND post.site_id = p.site_id
    WHERE p.site_id = ? AND p.token_hash = ? AND post.status <> 'archived'`).bind(siteId, hash).first<{ postId: string }>();
}

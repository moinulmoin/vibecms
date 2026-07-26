-- Pin the live public projection to an immutable post_versions row.
-- Draft edits continue to mutate posts.*; public reads use the pinned version.
ALTER TABLE posts ADD COLUMN published_version_id TEXT REFERENCES post_versions(id);

UPDATE posts
SET published_version_id = (
  SELECT pv.id
  FROM post_versions AS pv
  WHERE pv.post_id = posts.id
  ORDER BY pv.version_number DESC
  LIMIT 1
)
WHERE status = 'published'
  AND published_version_id IS NULL;

CREATE INDEX idx_posts_published_version_id ON posts(published_version_id);

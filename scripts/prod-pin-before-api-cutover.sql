-- Run after migrations and the new public Worker, BEFORE the new API deploys.
-- The old API is still live: under the old model a post's latest version is
-- its live content, so pinning it is correct. Never run this after the new
-- API is live — then the latest version can be a private, unapproved draft.
-- Idempotent: touches only published posts with no pinned version.
UPDATE posts
SET published_version_id = (
  SELECT pv.id FROM post_versions AS pv
  WHERE pv.post_id = posts.id
  ORDER BY pv.version_number DESC
  LIMIT 1
)
WHERE status = 'published'
  AND published_version_id IS NULL;

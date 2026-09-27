-- Run right after the first deploy of the versioned public reader (0018+).
-- The previous API could publish during the rollout window without pinning a
-- version; pin any such post to its latest version. Idempotent: touches only
-- published posts with no pinned version.
UPDATE posts
SET published_version_id = (
  SELECT pv.id FROM post_versions AS pv
  WHERE pv.post_id = posts.id
  ORDER BY pv.version_number DESC
  LIMIT 1
)
WHERE status = 'published'
  AND published_version_id IS NULL;

UPDATE user
SET email = lower(trim(email)),
    updated_at = unixepoch()
WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_canonical ON user(lower(email));

UPDATE posts
SET status = 'draft',
    updated_at = unixepoch()
WHERE status = 'scheduled';

UPDATE posts
SET published_at = COALESCE(
      (
        SELECT MAX(activity_events.created_at)
        FROM activity_events
        WHERE activity_events.site_id = posts.site_id
          AND activity_events.entity_type = 'post'
          AND activity_events.entity_id = posts.id
          AND activity_events.action = 'post.published'
      ),
      posts.updated_at
    )
WHERE status = 'published'
  AND published_at IS NULL;

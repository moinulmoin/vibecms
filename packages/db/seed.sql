PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at)
VALUES ('demo_workspace', 'Demo Workspace', 'demo', 1760000000, 1760000000);

INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role, created_at, updated_at)
VALUES ('demo_membership_owner', 'demo_workspace', 'demo_user', 'owner', 1760000000, 1760000000);

INSERT OR IGNORE INTO sites (
  id, workspace_id, name, slug, description, status, created_at, updated_at
) VALUES (
  'demo_site', 'demo_workspace', 'Demo Blog', 'demo', 'A seeded blog for local development.', 'active', 1760000000, 1760000000
);

INSERT OR IGNORE INTO domains (id, site_id, hostname, type, status, created_at, updated_at)
VALUES ('demo_domain_default', 'demo_site', 'demo.localhost', 'default', 'active', 1760000000, 1760000000);

INSERT OR IGNORE INTO posts (
  id, site_id, title, slug, excerpt, content_markdown, status, published_at,
  tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id,
  created_at, updated_at
) VALUES (
  'demo_post_published', 'demo_site', 'Welcome to the agent-native blog', 'welcome',
  'A published seeded post.', '# Welcome\n\nThis post is visible on the public blog.',
  'published', 1760000000, '["intro"]', 'human', 'demo_user', 'human', 'demo_user',
  1760000000, 1760000000
);

INSERT OR IGNORE INTO posts (
  id, site_id, title, slug, excerpt, content_markdown, status, published_at,
  tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id,
  created_at, updated_at
) VALUES (
  'demo_post_draft', 'demo_site', 'Draft launch notes', 'draft-launch-notes',
  'A draft seeded post.', '# Draft\n\nThis should not appear publicly.',
  'draft', NULL, '["draft"]', 'human', 'demo_user', 'human', 'demo_user',
  1760000100, 1760000100
);

INSERT OR IGNORE INTO post_versions (
  id, post_id, site_id, version_number, title, slug, excerpt, content_markdown,
  status, tags_json, created_by_type, created_by_id, change_summary, created_at
) VALUES (
  'demo_version_published_1', 'demo_post_published', 'demo_site', 1,
  'Welcome to the agent-native blog', 'welcome', 'A published seeded post.',
  '# Welcome\n\nThis post is visible on the public blog.', 'published', '["intro"]',
  'human', 'demo_user', 'Seeded published post', 1760000000
);

UPDATE posts SET published_version_id = 'demo_version_published_1' WHERE id = 'demo_post_published';

INSERT OR IGNORE INTO post_versions (
  id, post_id, site_id, version_number, title, slug, excerpt, content_markdown,
  status, tags_json, created_by_type, created_by_id, change_summary, created_at
) VALUES (
  'demo_version_draft_1', 'demo_post_draft', 'demo_site', 1,
  'Draft launch notes', 'draft-launch-notes', 'A draft seeded post.',
  '# Draft\n\nThis should not appear publicly.', 'draft', '["draft"]',
  'human', 'demo_user', 'Seeded draft post', 1760000100
);

INSERT OR IGNORE INTO activity_events (
  id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
  summary, created_at
) VALUES
  ('demo_activity_site_created', 'demo_site', 'system', 'system', 'System', 'site.created', 'site', 'demo_site', 'Created demo site', 1760000000),
  ('demo_activity_published_created', 'demo_site', 'human', 'demo_user', 'Demo User', 'post.created', 'post', 'demo_post_published', 'Created welcome post', 1760000000),
  ('demo_activity_draft_created', 'demo_site', 'human', 'demo_user', 'Demo User', 'post.created', 'post', 'demo_post_draft', 'Created draft post', 1760000100);

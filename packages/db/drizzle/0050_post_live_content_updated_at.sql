-- When the post's public page last substantively changed: set by publish only
-- when the newly pinned version's public fields differ from the live ones (or
-- the post goes live). Drives sitemap <lastmod>, dateModified and "Updated".
-- NULL on rows published before this column existed; readers fall back to the
-- pinned version's created_at, which is what they used before.
ALTER TABLE posts ADD COLUMN live_content_updated_at INTEGER;

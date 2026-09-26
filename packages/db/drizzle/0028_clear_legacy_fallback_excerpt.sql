-- 0026 previously wrote lossy SQL excerpts. All published versions with NULL
-- fallback are repopulated by the shared Markdown extractor on public read.
UPDATE post_versions SET fallback_excerpt = NULL;

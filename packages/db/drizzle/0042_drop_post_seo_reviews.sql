-- The Workers AI SEO review is gone (plans/028): vibecms runs no AI model on
-- customer content. Its per-version cache from 0035 has no reader or writer
-- left, so drop it with its index. Cached reviews are discarded, not migrated.
DROP INDEX IF EXISTS idx_post_seo_reviews_post_version_model;
DROP TABLE IF EXISTS post_seo_reviews;

-- AI SEO review cache (plans/024). A stored row means "we already paid for an
-- AI review of this exact post version with this exact model"; repeat requests
-- hit the cache instead of the AI binding. model is part of the key so a model
-- upgrade (SEO_REVIEW_MODEL change) re-reviews instead of serving stale output.
CREATE TABLE post_seo_reviews (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  neurons_estimate INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_post_seo_reviews_post_version_model ON post_seo_reviews(post_id, version_number, model);

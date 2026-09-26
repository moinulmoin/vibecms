ALTER TABLE post_versions ADD COLUMN fallback_excerpt TEXT;
-- Legacy Markdown needs the shared application parser. Leave existing versions
-- NULL so a public read can compute and persist the correct fallback lazily.

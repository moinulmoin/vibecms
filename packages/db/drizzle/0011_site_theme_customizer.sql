-- Theme customizer (Layer 2): per-site accent, font pairing, and color mode.
-- Additive only — nullable/resolver-default so existing rows keep working.
-- accent/font are nullable (fall back to curated defaults via resolveAccent/resolveFont);
-- mode defaults to 'system' (light/dark follows OS via prefers-color-scheme).
ALTER TABLE sites ADD COLUMN theme_accent TEXT;
ALTER TABLE sites ADD COLUMN theme_font TEXT;
ALTER TABLE sites ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'system';

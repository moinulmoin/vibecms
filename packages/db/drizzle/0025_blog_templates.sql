-- Blog templates (Phase 1/2): owner-tunable shape and the public byline.
-- All nullable or defaulted so existing sites keep their current look:
-- NULL radius/width means "use the template's default".
ALTER TABLE sites ADD COLUMN theme_radius TEXT;
ALTER TABLE sites ADD COLUMN theme_width TEXT;
-- Public name shown as author / reviewer. NULL falls back to the site name;
-- the account email is never shown on the public blog.
ALTER TABLE sites ADD COLUMN byline_name TEXT;
-- 1 = credit agent-written posts ("Written with an agent, reviewed by …").
ALTER TABLE sites ADD COLUMN show_agent_credit INTEGER NOT NULL DEFAULT 1;

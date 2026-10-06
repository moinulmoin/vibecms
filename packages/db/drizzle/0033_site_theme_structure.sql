-- Owner-selectable blog structure. NULL uses the template default.
ALTER TABLE sites ADD COLUMN theme_chrome TEXT;
ALTER TABLE sites ADD COLUMN theme_index TEXT;
ALTER TABLE sites ADD COLUMN theme_header TEXT;

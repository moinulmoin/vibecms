-- Add a curated public-blog theme to each site (minimal | editorial | terminal).
ALTER TABLE sites ADD COLUMN theme TEXT NOT NULL DEFAULT 'minimal';

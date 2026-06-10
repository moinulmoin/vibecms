-- Remove the premature public-blog theme column; launch scope is one markdown-first reader.
ALTER TABLE sites DROP COLUMN theme;

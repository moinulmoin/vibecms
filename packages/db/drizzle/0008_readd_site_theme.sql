-- Re-add the site theme column (removed in 0005) now that preset-based theming is in scope.
ALTER TABLE sites ADD COLUMN theme TEXT NOT NULL DEFAULT 'minimal';

-- Site-scoped, human-managed writing guidance for agents.
-- Profiles are optional: existing sites continue to work without a row.
CREATE TABLE site_voice_profiles (
  site_id TEXT PRIMARY KEY NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  audience TEXT
    CHECK (audience IS NULL OR length(audience) <= 300),
  voice_summary TEXT
    CHECK (voice_summary IS NULL OR length(voice_summary) <= 500),
  guidelines_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(guidelines_json) AND json_type(guidelines_json) = 'array' AND json_array_length(guidelines_json) <= 12),
  representative_post_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(representative_post_ids_json) AND json_type(representative_post_ids_json) = 'array' AND json_array_length(representative_post_ids_json) <= 3),
  updated_by_type TEXT NOT NULL
    CHECK (updated_by_type = 'human'),
  updated_by_id TEXT NOT NULL,
  updated_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

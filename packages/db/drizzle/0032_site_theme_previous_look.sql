CREATE TABLE site_theme_previous_look (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  look_json TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);

-- Voice is editable by a Manage key; preserve existing profiles while widening
-- the original human-only attribution check.
CREATE TABLE site_voice_profiles_new (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  audience TEXT CHECK (audience IS NULL OR length(audience) <= 300),
  voice_summary TEXT CHECK (voice_summary IS NULL OR length(voice_summary) <= 500),
  guidelines_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(guidelines_json) AND json_type(guidelines_json) = 'array' AND json_array_length(guidelines_json) <= 12),
  representative_post_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(representative_post_ids_json) AND json_type(representative_post_ids_json) = 'array' AND json_array_length(representative_post_ids_json) <= 3),
  updated_by_type TEXT NOT NULL CHECK (updated_by_type IN ('human', 'api_key', 'agent', 'system')),
  updated_by_id TEXT NOT NULL,
  updated_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO site_voice_profiles_new (site_id, audience, voice_summary, guidelines_json, representative_post_ids_json, updated_by_type, updated_by_id, updated_by_name, created_at, updated_at)
  SELECT site_id, audience, voice_summary, guidelines_json, representative_post_ids_json, updated_by_type, updated_by_id, updated_by_name, created_at, updated_at FROM site_voice_profiles;
DROP TABLE site_voice_profiles;
ALTER TABLE site_voice_profiles_new RENAME TO site_voice_profiles;

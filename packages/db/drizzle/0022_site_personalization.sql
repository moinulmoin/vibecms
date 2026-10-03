ALTER TABLE sites ADD COLUMN agent_preference TEXT;
ALTER TABLE sites ADD COLUMN voice_seed_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sites ADD COLUMN onboarding_note TEXT;

CREATE TABLE IF NOT EXISTS player_profiles (
  name TEXT PRIMARY KEY,
  seals_json TEXT NOT NULL DEFAULT '[]',
  active_seal TEXT,
  seal_shards INTEGER NOT NULL DEFAULT 0,
  seal_glow_json TEXT NOT NULL DEFAULT '{}',
  opened_boxes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  name TEXT PRIMARY KEY,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_name_expires
  ON account_sessions (name, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_sessions_expires
  ON account_sessions (expires_at);

ALTER TABLE player_profiles ADD COLUMN ability_state_json TEXT NOT NULL DEFAULT '{}';

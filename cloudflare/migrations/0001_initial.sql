CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  week_start TEXT NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 100,
  best_coins INTEGER NOT NULL DEFAULT 100,
  best_single_win INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (week_start, name)
);

CREATE INDEX IF NOT EXISTS idx_players_week_best_coins
  ON players (week_start, best_coins DESC);

CREATE INDEX IF NOT EXISTS idx_players_week_best_single_win
  ON players (week_start, best_single_win DESC);

CREATE TABLE IF NOT EXISTS weekly_champions (
  week_start TEXT PRIMARY KEY,
  week_label TEXT NOT NULL,
  winner_name TEXT,
  winner_score INTEGER,
  biggest_win_name TEXT,
  biggest_win_score INTEGER,
  archived_at INTEGER NOT NULL
);

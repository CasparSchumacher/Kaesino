CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_week_id
  ON chat_messages (week_start, id);

CREATE TABLE IF NOT EXISTS online_presence (
  week_start TEXT NOT NULL,
  name TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (week_start, name)
);

CREATE INDEX IF NOT EXISTS idx_online_presence_week_seen
  ON online_presence (week_start, last_seen DESC);

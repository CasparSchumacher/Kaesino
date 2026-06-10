CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_croupier_slot
  ON chat_messages (week_start, created_at)
  WHERE name = 'Käsino-Croupier';

CREATE TABLE IF NOT EXISTS user_presence (
  email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  game_id TEXT,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (email, session_id)
);
CREATE INDEX IF NOT EXISTS user_presence_seen_idx ON user_presence(last_seen);
CREATE TABLE IF NOT EXISTS member_messages (
  id TEXT PRIMARY KEY,
  sender_email TEXT NOT NULL,
  recipient_email TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS member_messages_recipient_idx ON member_messages(recipient_email, created_at);
CREATE INDEX IF NOT EXISTS member_messages_sender_idx ON member_messages(sender_email, created_at);
CREATE TABLE IF NOT EXISTS member_message_reads (
  message_id TEXT NOT NULL,
  email TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (message_id, email)
);

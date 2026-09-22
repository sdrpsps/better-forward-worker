CREATE TABLE auto_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  response TEXT NOT NULL,
  response_type TEXT NOT NULL CHECK (response_type IN ('text', 'media')),
  is_regex INTEGER NOT NULL CHECK (is_regex IN (0, 1)),
  start_time TEXT,
  end_time TEXT,
  time_zone TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
CREATE INDEX auto_responses_enabled_idx ON auto_responses(enabled);

CREATE TABLE blocked_users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  blocked_at INTEGER NOT NULL
);

CREATE TABLE verified_users (
  user_id TEXT PRIMARY KEY,
  verified_at INTEGER NOT NULL
);

CREATE TABLE user_permission_overrides (
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  override TEXT NOT NULL CHECK (override IN ('allow', 'deny')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE captcha_challenges (
  user_id TEXT PRIMARY KEY,
  left_operand INTEGER NOT NULL,
  right_operand INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TABLE spam_keywords (
  keyword TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

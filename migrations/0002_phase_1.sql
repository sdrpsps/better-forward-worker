CREATE TABLE topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  received_id TEXT NOT NULL,
  forwarded_id TEXT NOT NULL,
  in_group INTEGER NOT NULL CHECK (in_group IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (topic_id, received_id, in_group),
  UNIQUE (topic_id, forwarded_id, in_group)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'complete', 'failed')),
  attempts INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);

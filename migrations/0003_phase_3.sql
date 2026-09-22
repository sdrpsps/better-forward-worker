CREATE TABLE observed_invite_links (
  hash TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);

CREATE TABLE chat_id_resolution_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('resolved', 'not_observed', 'invalid')),
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_id_resolution_audits_hash_idx ON chat_id_resolution_audits(hash);

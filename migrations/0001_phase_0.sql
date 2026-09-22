CREATE TABLE admin_sessions (
  admin_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (admin_id, scope)
);

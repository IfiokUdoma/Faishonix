CREATE TABLE IF NOT EXISTS pilot_scans (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  item TEXT NOT NULL,
  measurements TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_scans_history ON pilot_scans (owner, timestamp DESC);

CREATE TABLE IF NOT EXISTS try_on_jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS try_on_quota (
  bucket TEXT PRIMARY KEY,
  uses INTEGER NOT NULL
);

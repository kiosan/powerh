-- powerh v1 schema. Single-user-per-install.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE user_profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT,
  birth_year   INTEGER,
  sex          TEXT,
  height_cm    REAL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- 'strava', etc.
  external_id   TEXT,                    -- athlete id from provider
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,                 -- unix seconds
  scope         TEXT,
  meta_json     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, external_id)
);

CREATE TABLE activities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source              TEXT NOT NULL,           -- 'strava'
  external_id         TEXT NOT NULL,
  kind                TEXT,                    -- 'Run', 'Ride', 'Swim', ...
  name                TEXT,
  started_at          TEXT NOT NULL,           -- ISO8601
  timezone            TEXT,
  duration_s          INTEGER,
  moving_time_s       INTEGER,
  distance_m          REAL,
  elevation_gain_m    REAL,
  avg_hr              REAL,
  max_hr              REAL,
  avg_power_w         REAL,
  calories            REAL,
  perceived_exertion  REAL,
  raw_json            TEXT,
  fetched_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_id)
);
CREATE INDEX idx_activities_started_at ON activities(started_at);
CREATE INDEX idx_activities_kind ON activities(kind);

CREATE TABLE activity_streams (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                  -- 'heartrate', 'power', 'cadence', 'altitude'
  data_blob   BLOB NOT NULL,                  -- json-encoded series
  PRIMARY KEY (activity_id, type)
);

CREATE TABLE medical_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  doc_type    TEXT,                          -- 'lab', 'other' (v1: lab only)
  source_lab  TEXT,
  taken_at    TEXT,                          -- date the test was performed
  raw_text    TEXT,                          -- optional extracted text
  notes       TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lab_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  marker       TEXT NOT NULL,                -- e.g. 'LDL', 'HbA1c', 'Ferritin'
  marker_canonical TEXT,                     -- normalized name for cross-doc comparison
  value        REAL,
  value_text   TEXT,                         -- when not numeric (e.g. 'Negative')
  unit         TEXT,
  ref_low      REAL,
  ref_high     REAL,
  flag         TEXT,                         -- 'low' | 'normal' | 'high' | NULL
  taken_at     TEXT,                         -- ISO8601 date
  notes        TEXT
);
CREATE INDEX idx_lab_results_marker ON lab_results(marker_canonical);
CREATE INDEX idx_lab_results_taken_at ON lab_results(taken_at);

CREATE TABLE body_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at    TEXT NOT NULL,
  weight_kg   REAL,
  resting_hr  REAL,
  hrv_ms      REAL,
  sleep_h     REAL,
  notes       TEXT
);
CREATE INDEX idx_body_metrics_taken_at ON body_metrics(taken_at);

CREATE TABLE journal (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at  TEXT NOT NULL,
  mood      INTEGER,                          -- 1-5
  soreness  INTEGER,                          -- 1-5
  energy    INTEGER,                          -- 1-5
  notes     TEXT
);

CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,             -- 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL,             -- JSON-encoded content blocks
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

CREATE TABLE agent_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                 -- 'observation' | 'preference' | 'goal' | 'digest'
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  horizon    TEXT,                          -- 'week' | 'month' | 'race-block'
  body_md    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'active' | 'archived'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

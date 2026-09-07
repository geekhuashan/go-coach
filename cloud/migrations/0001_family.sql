-- One household, multiple independently selected profiles. Never bind D1 to clients.
CREATE TABLE IF NOT EXISTS households (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
 op_token TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profiles (
 household_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
 state_json TEXT NOT NULL, helped_json TEXT NOT NULL DEFAULT '[]', runs_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (household_id,id), UNIQUE(household_id,name)
);
CREATE TABLE IF NOT EXISTS lessons (
 household_id TEXT NOT NULL, id TEXT NOT NULL, lesson_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(household_id,id)
);
CREATE TABLE IF NOT EXISTS matches (
 household_id TEXT NOT NULL, id TEXT NOT NULL, mode TEXT NOT NULL, size INTEGER NOT NULL,
 black_profile_id TEXT, white_profile_id TEXT, black_json TEXT NOT NULL, white_json TEXT NOT NULL,
 move_number INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0, result_json TEXT,
 state_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(household_id,id)
);
CREATE INDEX IF NOT EXISTS matches_black_recent ON matches(household_id,black_profile_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS matches_white_recent ON matches(household_id,white_profile_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, household_id TEXT NOT NULL, profile_id TEXT NOT NULL,
 lesson_id TEXT NOT NULL, correct INTEGER NOT NULL, assisted INTEGER NOT NULL, attempt_no INTEGER NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_profile_recent ON attempts(household_id,profile_id,id DESC);
CREATE INDEX IF NOT EXISTS attempts_lesson ON attempts(household_id,profile_id,lesson_id);
CREATE TABLE IF NOT EXISTS evidence (
 household_id TEXT NOT NULL, profile_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(household_id,profile_id,lesson_id)
);
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, household_id TEXT NOT NULL, profile_id TEXT NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_profile_recent ON notes(household_id,profile_id,id DESC);
CREATE TABLE IF NOT EXISTS llm_settings (
 household_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, encrypted_key TEXT
);
CREATE TABLE IF NOT EXISTS llm_explanations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, household_id TEXT NOT NULL, profile_id TEXT NOT NULL,
 context_key TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_profile_context ON llm_explanations(household_id,profile_id,context_key,id DESC);
CREATE TABLE IF NOT EXISTS ratings (
 household_id TEXT NOT NULL, profile_id TEXT NOT NULL, size INTEGER NOT NULL,
 rating REAL NOT NULL DEFAULT 1000, games INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(household_id,profile_id,size)
);
CREATE TABLE IF NOT EXISTS login_attempts (
 household_id TEXT NOT NULL, client_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL,
 PRIMARY KEY(household_id,client_hash)
);

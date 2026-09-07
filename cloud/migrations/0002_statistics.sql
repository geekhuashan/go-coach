CREATE TABLE IF NOT EXISTS match_stats (
 household_id TEXT NOT NULL, profile_id TEXT NOT NULL, size INTEGER NOT NULL, mode TEXT NOT NULL,
 played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
 losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(household_id,profile_id,size,mode)
);
CREATE TABLE IF NOT EXISTS helped_lessons (
 household_id TEXT NOT NULL, profile_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
 PRIMARY KEY(household_id,profile_id,lesson_id)
);

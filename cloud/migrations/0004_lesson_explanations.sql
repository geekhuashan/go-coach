-- Precomputed per-problem explanations (board facts, demos and a short reason). They contain
-- answers, so they live beside the private lessons instead of in public static assets.
CREATE TABLE IF NOT EXISTS lesson_explanations (
 household_id TEXT NOT NULL, lesson_id TEXT NOT NULL, version INTEGER NOT NULL, explanation_json TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(household_id,lesson_id)
);

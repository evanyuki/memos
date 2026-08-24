CREATE TABLE daily_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  checklist_date TEXT NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE')) DEFAULT 'PRIVATE',
  payload TEXT NOT NULL DEFAULT '{}',
  UNIQUE(creator_id, checklist_date)
);

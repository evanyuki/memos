CREATE TABLE daily_checklist (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER NOT NULL,
  checklist_date TEXT NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  payload JSONB NOT NULL DEFAULT '{}',
  UNIQUE(creator_id, checklist_date)
);

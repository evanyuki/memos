CREATE TABLE reaction_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  creator_id INTEGER,
  visitor_id TEXT,
  content_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  CHECK ((creator_id IS NULL) <> (visitor_id IS NULL)),
  UNIQUE(creator_id, content_id, reaction_type),
  UNIQUE(visitor_id, content_id, reaction_type)
);

INSERT INTO reaction_new (id, created_ts, creator_id, content_id, reaction_type)
SELECT id, created_ts, creator_id, content_id, reaction_type FROM reaction;

DROP TABLE reaction;
ALTER TABLE reaction_new RENAME TO reaction;

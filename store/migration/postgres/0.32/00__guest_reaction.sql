ALTER TABLE reaction
  ALTER COLUMN creator_id DROP NOT NULL,
  ADD COLUMN visitor_id TEXT,
  ADD CONSTRAINT reaction_identity_check CHECK ((creator_id IS NULL) <> (visitor_id IS NULL)),
  ADD CONSTRAINT reaction_visitor_unique UNIQUE (visitor_id, content_id, reaction_type);

ALTER TABLE `reaction`
  MODIFY COLUMN `creator_id` INT NULL,
  ADD COLUMN `visitor_id` VARCHAR(64) NULL AFTER `creator_id`,
  ADD CONSTRAINT `reaction_identity_check` CHECK ((`creator_id` IS NULL) <> (`visitor_id` IS NULL)),
  ADD UNIQUE KEY `reaction_visitor_unique` (`visitor_id`, `content_id`, `reaction_type`);

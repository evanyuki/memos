CREATE TABLE `daily_checklist` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `creator_id` INT NOT NULL,
  `checklist_date` VARCHAR(10) NOT NULL,
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `visibility` VARCHAR(16) NOT NULL DEFAULT 'PRIVATE',
  `payload` JSON NOT NULL,
  UNIQUE(`creator_id`, `checklist_date`)
);

-- MySQL commits DDL separately from the schema version update.
SET @memos_drop_setting_description = IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'system_setting' AND column_name = 'description'
  ),
  'ALTER TABLE system_setting DROP COLUMN description',
  'SELECT 1'
);
PREPARE memos_drop_setting_description FROM @memos_drop_setting_description;
EXECUTE memos_drop_setting_description;
DEALLOCATE PREPARE memos_drop_setting_description;

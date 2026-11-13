-- Idempotent role migration for MySQL 5.7, including existing installations.
SET @leinz_role_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leinz_users' AND COLUMN_NAME = 'role') = 0,
  'ALTER TABLE leinz_users ADD COLUMN role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''administrator''',
  'SELECT 1');
PREPARE leinz_role_migration FROM @leinz_role_ddl;
EXECUTE leinz_role_migration;
DEALLOCATE PREPARE leinz_role_migration;
ALTER TABLE leinz_users ALTER COLUMN role SET DEFAULT 'user';
INSERT IGNORE INTO leinz_schema_migrations (version, applied_at) VALUES (5, UTC_TIMESTAMP());

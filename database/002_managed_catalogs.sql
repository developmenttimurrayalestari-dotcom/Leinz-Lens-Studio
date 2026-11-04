-- One revision row serializes atomic updates of the three reference catalogs.
-- MySQL 5.7.24 compatible; existing catalog and user rows are retained.
CREATE TABLE IF NOT EXISTS leinz_catalog_revision (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO leinz_catalog_revision (id, revision, updated_at)
  VALUES (1, 0, UTC_TIMESTAMP());

INSERT IGNORE INTO leinz_schema_migrations (version, applied_at)
  VALUES (2, UTC_TIMESTAMP());

-- MySQL 5.7.24: no JSON defaults, no MySQL 8 collations, no ignored CHECK constraints.
-- Select the dedicated database before executing this script.
CREATE TABLE IF NOT EXISTS leinz_schema_migrations (
  version INT UNSIGNED NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leinz_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_leinz_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leinz_sessions (
  token_hash BINARY(32) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  csrf_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  KEY ix_leinz_session_expiry (expires_at),
  KEY ix_leinz_session_user (user_id),
  CONSTRAINT fk_leinz_session_user FOREIGN KEY (user_id) REFERENCES leinz_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leinz_catalog_documents (
  document_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_json JSON NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leinz_workspace_documents (
  document_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  document_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leinz_user_documents (
  user_id INT UNSIGNED NOT NULL,
  document_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_json JSON NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, document_key),
  CONSTRAINT fk_leinz_document_user FOREIGN KEY (user_id) REFERENCES leinz_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO leinz_schema_migrations (version, applied_at) VALUES (1, UTC_TIMESTAMP());

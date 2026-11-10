CREATE TABLE IF NOT EXISTS leinz_rel_sku_power_ranges (
  document_id VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  node_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `diameter` DOUBLE NULL,
  `sph_min` DOUBLE NULL,
  `sph_max` DOUBLE NULL,
  `cyl_min` DOUBLE NULL,
  `cyl_max` DOUBLE NULL,
  `add_min` DOUBLE NULL,
  `add_max` DOUBLE NULL,
  PRIMARY KEY(document_id,node_id),
  FOREIGN KEY(document_id,node_id) REFERENCES leinz_rel_entities(document_id,node_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

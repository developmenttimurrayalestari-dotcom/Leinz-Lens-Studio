import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from './config.mjs';
import { AppError } from './errors.mjs';
import { validateDocument, validateRevision, validateMasterCatalogs } from './validation.mjs';
import { username, hashPassword, tokenHash, newToken, newCsrf } from './auth.mjs';

export const TABLES = ['leinz_schema_migrations', 'leinz_users', 'leinz_sessions', 'leinz_catalog_documents', 'leinz_catalog_revision', 'leinz_workspace_documents', 'leinz_user_documents'];
export const createPool = config => mysql.createPool(config.mysql);
export const decodeJson = value => typeof value === 'string' ? JSON.parse(value) : value;
export const emptySkuCatalog = () => ({ schema: 'trl-sku-catalog/1.0', skus: [] });
const CATALOG_KEYS = ['materials', 'shapes', 'tints'];
function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}
export const catalogDigest = value => createHash('sha256').update(stableJson(value)).digest('hex');

export function checkMysqlVersion(version) {
  if (typeof version !== 'string' || !/^5\.7\.(\d+)(?:\D|$)/.test(version) || /mariadb/i.test(version)) throw Error('Server harus MySQL 5.7.24 atau patch 5.7 yang lebih baru; MariaDB/MySQL 8 belum termasuk target paket ini.');
  if (Number(version.match(/^5\.7\.(\d+)/)[1]) < 24) throw Error('Versi minimum MySQL adalah 5.7.24.');
  return version;
}

export async function inspectDatabase(pool, { requireSchema = true, requireSeed = true } = {}) {
  const [[row]] = await pool.query('SELECT VERSION() AS version, @@character_set_server AS charset, @@max_allowed_packet AS maxPacket, @@sql_mode AS sqlMode');
  checkMysqlVersion(row.version);
  if (Number(row.maxPacket) < 8 * 1024 * 1024) throw Error('MySQL max_allowed_packet harus minimal 8 MB; gunakan 16M pada konfigurasi server.');
  const [tables] = await pool.query('SHOW TABLES');
  const present = new Set(tables.map(item => Object.values(item)[0]));
  const missing = TABLES.filter(name => !present.has(name));
  if (requireSchema && missing.length) throw Error('Skema belum lengkap. Jalankan npm run db:migrate.');
  let catalogCount = 0, schemaVersion = 0, catalogRevision = null, masterCounts = null, catalogContentSha256 = null;
  if (present.has('leinz_schema_migrations')) {
    const [[version]] = await pool.query('SELECT MAX(version) AS version FROM leinz_schema_migrations'); schemaVersion = Number(version.version || 0);
  }
  if (requireSchema && schemaVersion < 2) throw Error('Skema perlu diperbarui. Jalankan npm run db:migrate untuk versi 2.1.');
  if (present.has('leinz_catalog_documents')) {
    const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM leinz_catalog_documents'); catalogCount = Number(count.n);
  }
  if (requireSeed && catalogCount !== 3) throw Error('Katalog belum lengkap. Jalankan npm run db:seed.');
  if (catalogCount === 3 && present.has('leinz_catalog_revision')) {
    const catalog = await readCatalogs(pool);
    catalogRevision = catalog.revision;
    const { materials, shapes, tints } = catalog.value;
    masterCounts = { products: materials.products?.length ?? 0, blanks: materials.blanks?.length ?? 0, powerRules: materials.rules?.length ?? 0, frameShapes: shapes.items?.length ?? 0, tinting: tints.items?.length ?? 0 };
    catalogContentSha256 = Object.fromEntries(CATALOG_KEYS.map(key => [key, catalogDigest(catalog.value[key])]));
    if (present.has('leinz_workspace_documents')) {
      const [skus] = await pool.execute('SELECT document_json FROM leinz_workspace_documents WHERE document_key = ?', ['skus']);
      masterCounts.skus = skus[0] ? (decodeJson(skus[0].document_json).skus?.length ?? 0) : 0;
    }
  }
  return { version: row.version, charset: row.charset, maxAllowedPacket: Number(row.maxPacket), sqlMode: row.sqlMode, tables: TABLES.filter(name => present.has(name)), catalogCount, schemaVersion, catalogRevision, masterCounts, catalogContentSha256 };
}

async function readCatalogs(connection) {
  // A single consistent read keeps the revision and all catalog rows in one snapshot.
  const [rows] = await connection.query('SELECT c.document_key, c.document_json, r.revision FROM leinz_catalog_documents c CROSS JOIN leinz_catalog_revision r WHERE r.id = 1 ORDER BY c.document_key');
  if (rows.length !== 3 || !CATALOG_KEYS.every(key => rows.some(row => row.document_key === key))) throw new AppError(503, 'catalog_uninitialized', 'Master belum lengkap. Jalankan db:migrate dan db:seed.');
  return { value: Object.fromEntries(rows.map(row => [row.document_key, decodeJson(row.document_json)])), revision: Number(rows[0].revision) };
}

export async function migrate(pool) {
  await inspectDatabase(pool, { requireSchema: false, requireSeed: false });
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':leinz-migrate'), 256), 15) AS acquired");
    if (Number(lock.acquired) !== 1) throw Error('Migrasi lain sedang berjalan. Coba kembali setelah selesai.');
    for (const file of ['001_initial.sql', '002_managed_catalogs.sql']) {
      const sql = await readFile(resolve(PROJECT_ROOT, 'database', file), 'utf8');
      const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(text => text.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
    }
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':leinz-migrate'), 256))"); } catch { /* connection may have failed */ }
    connection.release();
  }
}

export async function seed(pool) {
  await inspectDatabase(pool, { requireSeed: false });
  const catalogs = {}, values = {};
  for (const key of ['tints', 'materials', 'shapes']) {
    const text = await readFile(resolve(PROJECT_ROOT, `dist/assets/${key}.json`), 'utf8');
    const json = JSON.parse(text); values[key] = json;
    catalogs[key] = { text: JSON.stringify(json), json, sha: catalogDigest(json) };
  }
  validateMasterCatalogs(values);
  if (!values.tints.items.length || !values.shapes.items.length || !values.materials.products.length || !values.materials.blanks.length || !values.materials.rules.length) throw Error('Aset katalog paket tidak lengkap.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[lock]] = await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id = 1 FOR UPDATE');
    if (!lock) throw Error('Revisi katalog belum dibuat. Jalankan npm run db:migrate.');
    let inserted = 0;
    for (const [key, item] of Object.entries(catalogs)) {
      const [result] = await connection.execute('INSERT IGNORE INTO leinz_catalog_documents (document_key, document_json, source_sha256, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [key, item.text, item.sha]);
      inserted += result.affectedRows;
    }
    if (inserted) await connection.query('UPDATE leinz_catalog_revision SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE id = 1');
    await connection.execute('INSERT IGNORE INTO leinz_workspace_documents (document_key, document_json, revision, updated_at) VALUES (?, ?, 0, UTC_TIMESTAMP())', ['skus', JSON.stringify(emptySkuCatalog())]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function createUser(pool, name, password) {
  const userName = username(name), hash = await hashPassword(password);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO leinz_users (username, password_hash, active, created_at) VALUES (?, ?, 1, UTC_TIMESTAMP())', [userName, hash]);
    for (const [key, value] of [['state', null], ['saved', []]]) await connection.execute('INSERT INTO leinz_user_documents (user_id, document_key, document_json, revision, updated_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP())', [result.insertId, key, JSON.stringify(value)]);
    await connection.commit();
    return { id: Number(result.insertId), username: userName };
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw Error('Username sudah terdaftar. Akun lama tidak diubah.');
    throw error;
  } finally { connection.release(); }
}

export class MysqlStore {
  constructor(pool, config) { this.pool = pool; this.config = config; this.catalogs = null; this.databaseInfo = null; }
  async initialize() {
    this.databaseInfo = await inspectDatabase(this.pool);
    this.catalogs = validateMasterCatalogs((await this.getCatalogs()).value);
    const doc = await this.getDocument(null, 'skus');
    validateDocument('skus', doc.value, this.catalogs);
  }
  async health() { await this.pool.query('SELECT 1'); return { database: 'mysql', databaseVersion: this.databaseInfo.version, ready: true }; }
  async userByName(name) { const [rows] = await this.pool.execute('SELECT id, username, password_hash, active FROM leinz_users WHERE username = ? LIMIT 1', [name]); return rows[0] || null; }
  async getSession(token) {
    if (!token) return null;
    const [rows] = await this.pool.execute('SELECT u.id, u.username, s.csrf_token FROM leinz_sessions s INNER JOIN leinz_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.active = 1 LIMIT 1', [tokenHash(token)]);
    return rows[0] ? { user: { id: Number(rows[0].id), username: rows[0].username }, csrfToken: rows[0].csrf_token } : null;
  }
  async createSession(user) {
    const token = newToken(), csrfToken = newCsrf();
    await this.pool.execute('DELETE FROM leinz_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    await this.pool.execute('INSERT INTO leinz_sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR), UTC_TIMESTAMP())', [tokenHash(token), user.id, csrfToken, this.config.sessionHours]);
    return { token, csrfToken, user: { id: Number(user.id), username: user.username } };
  }
  async removeSession(token) { if (token) await this.pool.execute('DELETE FROM leinz_sessions WHERE token_hash = ?', [tokenHash(token)]); }
  async getCatalogs(connection = this.pool) { return readCatalogs(connection); }
  async putCatalogs(value, revision) {
    validateRevision(revision);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id = 1 FOR UPDATE');
      if (!row) throw new AppError(503, 'catalog_uninitialized', 'Revisi master belum dibuat. Jalankan db:migrate.');
      const current = await this.getCatalogs(connection);
      if (Number(row.revision) !== revision) throw new AppError(409, 'revision_conflict', 'Master berubah di sesi lain. Muat master terbaru dan tinjau kembali perubahan Anda.', { document: current });
      const skuCatalog = (await this.getDocument(null, 'skus', connection)).value;
      const validated = validateMasterCatalogs(value, { previous: current.value, skuCatalog });
      for (const key of CATALOG_KEYS) await connection.execute('UPDATE leinz_catalog_documents SET document_json = ?, source_sha256 = ?, updated_at = UTC_TIMESTAMP() WHERE document_key = ?', [JSON.stringify(validated[key]), catalogDigest(validated[key]), key]);
      await connection.execute('UPDATE leinz_catalog_revision SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE id = 1 AND revision = ?', [revision]);
      await connection.commit(); this.catalogs = validated;
      return { value: validated, revision: revision + 1 };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async getDocument(userId, key, connection = this.pool, lock = false) {
    const shared = key === 'skus';
    if (!['state', 'saved', 'skus'].includes(key)) throw new AppError(404, 'not_found', 'Dokumen tidak ditemukan.');
    const [rows] = shared
      ? await connection.execute('SELECT document_json, revision FROM leinz_workspace_documents WHERE document_key = ?' + (lock ? ' FOR UPDATE' : ''), [key])
      : await connection.execute('SELECT document_json, revision FROM leinz_user_documents WHERE user_id = ? AND document_key = ?' + (lock ? ' FOR UPDATE' : ''), [userId, key]);
    if (!rows[0]) throw new AppError(503, 'storage_uninitialized', 'Dokumen database belum dibuat. Jalankan migrasi, seed, dan pembuatan akun.');
    return { value: decodeJson(rows[0].document_json), revision: Number(rows[0].revision) };
  }
  async putDocument(userId, key, value, revision) {
    validateRevision(revision);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Catalog writes take FOR UPDATE on this row. This shared lock keeps SKU
      // and consultation validation consistent with the committed catalog.
      const [[lock]] = await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id = 1 LOCK IN SHARE MODE');
      if (!lock) throw new AppError(503, 'catalog_uninitialized', 'Revisi master belum dibuat. Jalankan db:migrate.');
      const catalogs = (await this.getCatalogs(connection)).value;
      const validated = validateDocument(key, value, catalogs), text = JSON.stringify(validated);
      const [result] = key === 'skus'
        ? await connection.execute('UPDATE leinz_workspace_documents SET document_json = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE document_key = ? AND revision = ?', [text, key, revision])
        : await connection.execute('UPDATE leinz_user_documents SET document_json = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ? AND document_key = ? AND revision = ?', [text, userId, key, revision]);
      if (result.affectedRows !== 1) throw new AppError(409, 'revision_conflict', 'Data telah berubah di sesi lain. Muat data server dan tinjau perubahan sebelum menyimpan kembali.', { document: await this.getDocument(userId, key, connection, true) });
      await connection.commit();
      return { value: validated, revision: revision + 1 };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async bootstrap(userId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const catalog = await this.getCatalogs(connection);
      const documents = {};
      for (const key of ['state', 'saved', 'skus']) documents[key] = await this.getDocument(userId, key, connection);
      await connection.commit();
      return { catalogs: catalog.value, catalogRevision: catalog.revision, documents };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}

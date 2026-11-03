import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from './config.mjs';
import { AppError } from './errors.mjs';
import { validateDocument, validateRevision } from './validation.mjs';
import { username, hashPassword, tokenHash, newToken, newCsrf } from './auth.mjs';

export const TABLES = ['leinz_schema_migrations', 'leinz_users', 'leinz_sessions', 'leinz_catalog_documents', 'leinz_workspace_documents', 'leinz_user_documents'];
export const createPool = config => mysql.createPool(config.mysql);
export const decodeJson = value => typeof value === 'string' ? JSON.parse(value) : value;
export const emptySkuCatalog = () => ({ schema: 'trl-sku-catalog/1.0', skus: [] });

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
  let catalogCount = 0;
  if (present.has('leinz_catalog_documents')) {
    const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM leinz_catalog_documents'); catalogCount = Number(count.n);
  }
  if (requireSeed && catalogCount !== 3) throw Error('Katalog belum lengkap. Jalankan npm run db:seed.');
  return { version: row.version, charset: row.charset, maxAllowedPacket: Number(row.maxPacket), sqlMode: row.sqlMode, tables: TABLES.filter(name => present.has(name)), catalogCount };
}

export async function migrate(pool) {
  await inspectDatabase(pool, { requireSchema: false, requireSeed: false });
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':leinz-migrate'), 256), 15) AS acquired");
    if (Number(lock.acquired) !== 1) throw Error('Migrasi lain sedang berjalan. Coba kembali setelah selesai.');
    const sql = await readFile(resolve(PROJECT_ROOT, 'database/001_initial.sql'), 'utf8');
    const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(text => text.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':leinz-migrate'), 256))"); } catch { /* connection may have failed */ }
    connection.release();
  }
}

export async function seed(pool) {
  await inspectDatabase(pool, { requireSeed: false });
  const catalogs = {};
  for (const key of ['tints', 'materials', 'shapes']) {
    const text = await readFile(resolve(PROJECT_ROOT, `dist/assets/${key}.json`), 'utf8');
    catalogs[key] = { text, json: JSON.parse(text), sha: createHash('sha256').update(text).digest('hex') };
  }
  if (catalogs.tints.json.items?.length !== 66 || catalogs.shapes.json.items?.length !== 13 || !catalogs.materials.json.blanks?.length) throw Error('Aset katalog paket tidak lengkap.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [key, item] of Object.entries(catalogs)) await connection.execute('INSERT INTO leinz_catalog_documents (document_key, document_json, source_sha256, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE document_json = VALUES(document_json), source_sha256 = VALUES(source_sha256), updated_at = VALUES(updated_at)', [key, item.text, item.sha]);
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
    const [rows] = await this.pool.query('SELECT document_key, document_json FROM leinz_catalog_documents');
    this.catalogs = Object.fromEntries(rows.map(row => [row.document_key, decodeJson(row.document_json)]));
    if (!this.catalogs.tints?.items || !this.catalogs.materials?.products || !this.catalogs.shapes?.items) throw Error('Katalog database tidak valid. Jalankan ulang seed dari paket yang benar.');
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
  async getDocument(userId, key) {
    const shared = key === 'skus';
    if (!['state', 'saved', 'skus'].includes(key)) throw new AppError(404, 'not_found', 'Dokumen tidak ditemukan.');
    const [rows] = shared
      ? await this.pool.execute('SELECT document_json, revision FROM leinz_workspace_documents WHERE document_key = ?', [key])
      : await this.pool.execute('SELECT document_json, revision FROM leinz_user_documents WHERE user_id = ? AND document_key = ?', [userId, key]);
    if (!rows[0]) throw new AppError(503, 'storage_uninitialized', 'Dokumen database belum dibuat. Jalankan migrasi, seed, dan pembuatan akun.');
    return { value: decodeJson(rows[0].document_json), revision: Number(rows[0].revision) };
  }
  async putDocument(userId, key, value, revision) {
    validateRevision(revision);
    const validated = validateDocument(key, value, this.catalogs), text = JSON.stringify(validated);
    const [result] = key === 'skus'
      ? await this.pool.execute('UPDATE leinz_workspace_documents SET document_json = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE document_key = ? AND revision = ?', [text, key, revision])
      : await this.pool.execute('UPDATE leinz_user_documents SET document_json = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ? AND document_key = ? AND revision = ?', [text, userId, key, revision]);
    if (result.affectedRows !== 1) throw new AppError(409, 'revision_conflict', 'Data telah berubah di sesi lain. Muat data server dan tinjau perubahan sebelum menyimpan kembali.', { document: await this.getDocument(userId, key) });
    return { value: validated, revision: revision + 1 };
  }
  async bootstrap(userId) {
    const [state, saved, skus] = await Promise.all(['state', 'saved', 'skus'].map(key => this.getDocument(userId, key)));
    return { catalogs: this.catalogs, documents: { state, saved, skus } };
  }
}

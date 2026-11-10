import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from './config.mjs';
import { AppError } from './errors.mjs';
import { validateDocument, validateRevision, validateMasterCatalogs, validateMasterDeletion } from './validation.mjs';
import { username, hashPassword, tokenHash, newToken, newCsrf } from './auth.mjs';
import { REL_TABLES, readRelational, writeRelational, assertPreserved, documentId } from './relational.mjs';

export const TABLES = ['leinz_schema_migrations', 'leinz_users', 'leinz_sessions', 'leinz_catalog_documents', 'leinz_catalog_revision', 'leinz_workspace_documents', 'leinz_user_documents', ...REL_TABLES];
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
  if (requireSchema && schemaVersion < 4) throw Error('Skema perlu diperbarui. Jalankan npm run db:migrate untuk range SKU per diameter (skema 4).');
  if (present.has('leinz_catalog_documents')) {
    const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM leinz_catalog_documents'); catalogCount = Number(count.n);
  }
  if (requireSeed && catalogCount !== 3) throw Error('Katalog belum lengkap. Jalankan npm run db:seed.');
  if (catalogCount === 3 && schemaVersion >= 3 && present.has('leinz_catalog_revision')) {
    const catalog = await readCatalogs(pool);
    catalogRevision = catalog.revision;
    const { materials, shapes, tints } = catalog.value;
    masterCounts = { products: materials.products?.length ?? 0, blanks: materials.blanks?.length ?? 0, powerRules: materials.rules?.length ?? 0, frameShapes: shapes.items?.length ?? 0, tinting: tints.items?.length ?? 0 };
    catalogContentSha256 = Object.fromEntries(CATALOG_KEYS.map(key => [key, catalogDigest(catalog.value[key])]));
    if (present.has('leinz_workspace_documents')) {
      const [skus] = await pool.query('SELECT COUNT(*) AS n FROM leinz_rel_sku_items');
      masterCounts.skus = Number(skus[0].n);
    }
  }
  return { version: row.version, charset: row.charset, maxAllowedPacket: Number(row.maxPacket), sqlMode: row.sqlMode, tables: TABLES.filter(name => present.has(name)), catalogCount, schemaVersion, catalogRevision, masterCounts, catalogContentSha256 };
}

async function snapshot(source, operation) {
  if (typeof source.getConnection !== 'function') return operation(source);
  const connection = await source.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit(); return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function readCatalogs(source) {
  return snapshot(source, async connection => {
    const [rows] = await connection.query('SELECT c.document_key, r.revision FROM leinz_catalog_documents c CROSS JOIN leinz_catalog_revision r WHERE r.id = 1 ORDER BY c.document_key');
    if (rows.length !== 3 || !CATALOG_KEYS.every(key => rows.some(row => row.document_key === key))) throw new AppError(503, 'catalog_uninitialized', 'Master belum lengkap. Jalankan db:migrate dan db:seed.');
    const value = {};
    for (const row of rows) value[row.document_key] = await readRelational(connection,'catalog',row.document_key);
    return { value, revision: Number(rows[0].revision) };
  });
}

// DDL is deliberately outside this transaction: MySQL 5.7 DDL commits implicitly.
// All legacy rows, extracted values, verification and version marking are then
// locked/committed together. A rerun never imports frozen JSON over live tables.
export async function backfillRelational(connection) {
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.beginTransaction();
  try {
    const [[version]] = await connection.query('SELECT MAX(version) AS version FROM leinz_schema_migrations');
    if (Number(version.version) >= 3) { await connection.commit(); return; }
    await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id=1 FOR UPDATE');
    const [catalogs] = await connection.query('SELECT document_key,document_json FROM leinz_catalog_documents ORDER BY document_key FOR UPDATE');
    const [workspace] = await connection.query('SELECT document_key,document_json FROM leinz_workspace_documents ORDER BY document_key FOR UPDATE');
    const [users] = await connection.query('SELECT user_id,document_key FROM leinz_user_documents ORDER BY user_id,document_key FOR UPDATE');
    const documents = [...catalogs.map(r => ({...r,scope:'catalog'})),...workspace.map(r => ({...r,scope:'workspace'})),...users.map(r => ({...r,scope:'user'}))];
    // All master types must exist before SKU foreign keys are inserted.
    const priority = {materials:0,shapes:1,tints:2,skus:3,state:4,saved:5};
    documents.sort((a,b) => (priority[a.document_key] ?? 99)-(priority[b.document_key] ?? 99));
    for (const row of documents) {
      const userId = row.user_id ?? null;
      if (row.scope === 'user') {
        const [[source]] = await connection.execute('SELECT document_json FROM leinz_user_documents WHERE user_id=? AND document_key=?',[userId,row.document_key]);
        row.document_json = source.document_json;
      }
      const value = decodeJson(row.document_json);
      await writeRelational(connection,row.scope,row.document_key,value,userId);
      assertPreserved(value,await readRelational(connection,row.scope,row.document_key,userId),`${row.scope}/${row.document_key}/${userId ?? ''}`);
      await connection.execute('UPDATE leinz_rel_documents SET migrated_sha256=?,migrated_at=UTC_TIMESTAMP() WHERE document_id=?',[catalogDigest(value),documentId(row.scope,row.document_key,userId)]);
      delete row.document_json;
    }
    await connection.query('INSERT INTO leinz_schema_migrations (version,applied_at) VALUES (3,UTC_TIMESTAMP())');
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
}

export async function migrate(pool) {
  await inspectDatabase(pool, { requireSchema: false, requireSeed: false });
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':leinz-migrate'), 256), 15) AS acquired");
    if (Number(lock.acquired) !== 1) throw Error('Migrasi lain sedang berjalan. Coba kembali setelah selesai.');
    for (const file of ['001_initial.sql', '002_managed_catalogs.sql', '003_relational_documents.sql', '004_sku_power_ranges.sql']) {
      const sql = await readFile(resolve(PROJECT_ROOT, 'database', file), 'utf8');
      const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(text => text.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
    }
    await backfillRelational(connection);
    await connection.query('INSERT IGNORE INTO leinz_schema_migrations (version,applied_at) VALUES (4,UTC_TIMESTAMP())');
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
      const [[existing]] = await connection.execute('SELECT document_id FROM leinz_rel_documents WHERE document_id=?',[documentId('catalog',key)]);
      if (!existing) {
        const [[legacy]] = await connection.execute('SELECT document_json FROM leinz_catalog_documents WHERE document_key=?',[key]);
        await writeRelational(connection,'catalog',key,decodeJson(legacy.document_json));
      }
    }
    if (inserted) await connection.query('UPDATE leinz_catalog_revision SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE id = 1');
    await connection.execute('INSERT IGNORE INTO leinz_workspace_documents (document_key, document_json, revision, updated_at) VALUES (?, ?, 0, UTC_TIMESTAMP())', ['skus', JSON.stringify(emptySkuCatalog())]);
    const [[skuRel]] = await connection.execute('SELECT document_id FROM leinz_rel_documents WHERE document_id=?',[documentId('workspace','skus')]);
    if (!skuRel) {
      const [[legacy]] = await connection.query("SELECT document_json FROM leinz_workspace_documents WHERE document_key='skus'");
      await writeRelational(connection,'workspace','skus',decodeJson(legacy.document_json));
    }
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
    for (const [key, value] of [['state', null], ['saved', []]]) {
      await connection.execute('INSERT INTO leinz_user_documents (user_id, document_key, document_json, revision, updated_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP())', [result.insertId, key, JSON.stringify(value)]);
      await writeRelational(connection,'user',key,value,result.insertId);
    }
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
  async referencedDocuments(connection) {
    const [rows]=await connection.query("SELECT user_id,document_key FROM leinz_user_documents WHERE document_key IN ('state','saved') ORDER BY user_id,document_key");
    const values=[];
    for(const row of rows)values.push(await readRelational(connection,'user',row.document_key,row.user_id));
    return values;
  }
  async putCatalogs(value, revision, deletion = null) {
    validateRevision(revision);
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      const [[row]] = await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id = 1 FOR UPDATE');
      if (!row) throw new AppError(503, 'catalog_uninitialized', 'Revisi master belum dibuat. Jalankan db:migrate.');
      const current = await this.getCatalogs(connection);
      if (Number(row.revision) !== revision) throw new AppError(409, 'revision_conflict', 'Master berubah di sesi lain. Muat master terbaru dan tinjau kembali perubahan Anda.', { document: current });
      const skuCatalog = (await this.getDocument(null, 'skus', connection)).value;
      if(deletion)value=validateMasterDeletion(current.value,deletion,{skuCatalog,documents:await this.referencedDocuments(connection)});
      const validated = validateMasterCatalogs(value, { previous: current.value, skuCatalog,allowDelete:Boolean(deletion) });
      for (const key of CATALOG_KEYS) {
        await writeRelational(connection,'catalog',key,validated[key]);
        await connection.execute('UPDATE leinz_catalog_documents SET updated_at = UTC_TIMESTAMP() WHERE document_key = ?', [key]);
      }
      await connection.execute('UPDATE leinz_catalog_revision SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE id = 1 AND revision = ?', [revision]);
      await connection.commit(); this.catalogs = validated;
      return { value: validated, revision: revision + 1 };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async getDocument(userId, key, connection = this.pool, lock = false) {
    const shared = key === 'skus';
    if (!['state', 'saved', 'skus'].includes(key)) throw new AppError(404, 'not_found', 'Dokumen tidak ditemukan.');
    return snapshot(connection, async connection => {
      const [rows] = shared
        ? await connection.execute('SELECT revision FROM leinz_workspace_documents WHERE document_key = ?' + (lock ? ' FOR UPDATE' : ''), [key])
        : await connection.execute('SELECT revision FROM leinz_user_documents WHERE user_id = ? AND document_key = ?' + (lock ? ' FOR UPDATE' : ''), [userId, key]);
      if (!rows[0]) throw new AppError(503, 'storage_uninitialized', 'Dokumen database belum dibuat. Jalankan migrasi, seed, dan pembuatan akun.');
      return { value: await readRelational(connection,shared ? 'workspace' : 'user',key,shared ? null : userId), revision: Number(rows[0].revision) };
    });
  }
  async putDocument(userId, key, value, revision) {
    validateRevision(revision);
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      // Catalog writes take FOR UPDATE on this row. This shared lock keeps SKU
      // and consultation validation consistent with the committed catalog.
      const [[lock]] = await connection.query('SELECT revision FROM leinz_catalog_revision WHERE id = 1 '+(key==='skus'?'FOR UPDATE':'LOCK IN SHARE MODE'));
      if (!lock) throw new AppError(503, 'catalog_uninitialized', 'Revisi master belum dibuat. Jalankan db:migrate.');
      const catalogs = (await this.getCatalogs(connection)).value;
      const validated = validateDocument(key, value, catalogs);
      if(key==='skus') {
        const old=(await this.getDocument(null,'skus',connection)).value;
        const removed=new Set(old.skus.filter(s=>!validated.skus.some(n=>n.id===s.id)).map(s=>s.id));
        if(removed.size) {
          const references=await this.referencedDocuments(connection);
          const used=s=>s&&['a','b'].some(k=>removed.has(s[k]?.skuId));
          if(references.some(d=>used(d)||Array.isArray(d)&&d.some(e=>used(e?.state))))throw new AppError(422,'sku_in_use','SKU masih dipakai dalam draft atau riwayat konsultasi. Lepaskan referensinya sebelum menghapus.');
        }
      }
      const [result] = key === 'skus'
        ? await connection.execute('UPDATE leinz_workspace_documents SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE document_key = ? AND revision = ?', [key, revision])
        : await connection.execute('UPDATE leinz_user_documents SET revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ? AND document_key = ? AND revision = ?', [userId, key, revision]);
      if (result.affectedRows !== 1) {
        // A failed conditional UPDATE may have waited for another writer. Start
        // a fresh snapshot after rollback to return its complete committed value.
        await connection.rollback();
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.beginTransaction();
        throw new AppError(409, 'revision_conflict', 'Data telah berubah di sesi lain. Muat data server dan tinjau perubahan sebelum menyimpan kembali.', { document: await this.getDocument(userId,key,connection) });
      }
      await writeRelational(connection,key === 'skus' ? 'workspace' : 'user',key,validated,key === 'skus' ? null : userId);
      await connection.commit();
      return { value: validated, revision: revision + 1 };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async bootstrap(userId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
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

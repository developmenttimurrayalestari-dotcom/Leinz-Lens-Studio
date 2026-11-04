import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_VERSION = '2.1.1';

function integer(value, fallback, min, max, name) {
  const text = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(text) || +text < min || +text > max) throw Error(`${name} harus berupa bilangan ${min}–${max}.`);
  return +text;
}

export function loadConfig({ env = process.env, envFile = resolve(PROJECT_ROOT, '.env') } = {}) {
  let file = {};
  try { file = parseEnv(readFileSync(envFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Berkas .env tidak dapat dibaca. Periksa izin dan formatnya.'); }
  const values = { ...file, ...env };
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (![22, 24].includes(nodeMajor)) throw Error('Gunakan Node.js 22 atau 24 untuk paket ini.');
  const port = integer(values.PORT, 3000, 1, 65535, 'PORT');
  const host = values.HOST || '127.0.0.1';
  if (!/^[A-Za-z0-9.:[\]_-]+$/.test(host)) throw Error('HOST tidak valid.');
  let url;
  try { url = new URL(values.APP_URL || `http://localhost:${port}`); } catch { throw Error('APP_URL harus berupa URL HTTP/HTTPS yang valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('APP_URL harus berupa origin HTTP/HTTPS tanpa path, kredensial, query, atau fragmen.');
  const required = key => { const value = values[key]; if (typeof value !== 'string' || value === '' || value === 'replace-with-database-password') throw Error(`${key} belum diisi di .env.`); return value; };
  const database = required('MYSQL_DATABASE');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw Error('MYSQL_DATABASE hanya boleh berisi huruf, angka, atau underscore, maksimal 64 karakter.');
  const mysql = {
    host: values.MYSQL_HOST || '127.0.0.1',
    port: integer(values.MYSQL_PORT, 3306, 1, 65535, 'MYSQL_PORT'),
    database, user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD'),
    charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: true,
    waitForConnections: true, connectionLimit: integer(values.MYSQL_POOL_SIZE, 5, 1, 20, 'MYSQL_POOL_SIZE'),
    queueLimit: 100, connectTimeout: 10000, multipleStatements: false,
    decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: true
  };
  if (values.MYSQL_SSL_CA) {
    try { mysql.ssl = { ca: readFileSync(resolve(PROJECT_ROOT, values.MYSQL_SSL_CA), 'utf8'), rejectUnauthorized: true }; }
    catch { throw Error('MYSQL_SSL_CA belum dapat dibaca.'); }
  }
  return {
    host, port, origin: url.origin, secureCookie: url.protocol === 'https:', mysql,
    sessionHours: integer(values.SESSION_HOURS, 8, 1, 168, 'SESSION_HOURS'),
    bodyLimit: 8 * 1024 * 1024,
    adminUsername: values.ADMIN_USERNAME || '', adminPassword: values.ADMIN_PASSWORD || ''
  };
}

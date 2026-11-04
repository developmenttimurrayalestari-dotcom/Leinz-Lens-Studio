import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadConfig, PROJECT_ROOT } from './config.mjs';
import { checkMysqlVersion } from './db.mjs';
import { hashPassword, verifyPassword, username, validatePassword, readSessionToken, newToken, tokenHash, equalSecret, sessionCookie, LoginLimiter } from './auth.mjs';
import { validateDocument, validateRevision, checkJson } from './validation.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getAppearance } = require('../dist/photochromic.js');

const catalogs = Object.fromEntries(await Promise.all(['tints', 'materials', 'shapes'].map(async key => [key, JSON.parse(await readFile(resolve(PROJECT_ROOT, `dist/assets/${key}.json`), 'utf8'))])));
const env = { MYSQL_DATABASE: 'leinz_test', MYSQL_USER: 'test_user', MYSQL_PASSWORD: 'example-only-unit-test', APP_URL: 'http://localhost:3000' };
const config = () => loadConfig({ env, envFile: resolve(tmpdir(), 'leinz-file-not-present-unit-test') });
const state = () => ({ active: 'a', shape: '001', width: 52, height: 38, dbl: 18, sph: -4, cyl: -1, axis: 180, add: 0, pdR: 31.5, pdL: 31.5, heightR: 19, heightL: 19, allowanceDiameter: 2, sync: true, showFrame: true, showTemples: true, frameStyle: 'rimless', camera: { yaw: -.62, pitch: .12, zoom: 1 }, a: { index: '1.74', productId: 'DMO:SPHW74', skuId: null, blankIdR: null, blankIdL: null, tintCode: '09S', note: 'Uji warna', customColor: '#abcdef' }, b: { index: '1.50', productId: 'SOA:SPHW50', skuId: null, blankIdR: null, blankIdL: null, tintCode: null, note: '', customColor: '#abcdef' } });

test('configuration defaults bind loopback, enforce MySQL fields, and validate origin', () => {
  const value = config(); assert.equal(value.host, '127.0.0.1'); assert.equal(value.port, 3000); assert.equal(value.mysql.charset, 'utf8mb4_unicode_ci'); assert.equal(value.mysql.multipleStatements, false);
  assert.throws(() => loadConfig({ env: { ...env, MYSQL_DATABASE: 'bad; DROP' }, envFile: '/missing' }), /MYSQL_DATABASE/);
  assert.throws(() => loadConfig({ env: { ...env, MYSQL_PASSWORD: '' }, envFile: '/missing' }), /MYSQL_PASSWORD/);
  assert.throws(() => loadConfig({ env: { ...env, APP_URL: 'https://example.test/subpath' }, envFile: '/missing' }), /APP_URL/);
  assert.throws(() => loadConfig({ env: { ...env, MYSQL_PORT: '3.5' }, envFile: '/missing' }), /MYSQL_PORT/);
  assert.equal(loadConfig({ env: { ...env, APP_URL: 'https://example.test' }, envFile: '/missing' }).secureCookie, true);
});

test('quoted environment passwords preserve #, spaces, and environment override', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'leinz-config-'));
  try {
    const file = resolve(directory, '.env');
    await writeFile(file, 'MYSQL_DATABASE=leinz_test\nMYSQL_USER=test_user\nMYSQL_PASSWORD="spaces # and = symbols"\nPORT=3001\n');
    const value = loadConfig({ env: { PORT: '3002' }, envFile: file });
    assert.equal(value.mysql.password, 'spaces # and = symbols'); assert.equal(value.port, 3002);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('password hashes are salted, verifiable, and never contain plaintext', async () => {
  const password = 'Test-only-Password-é';
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b); assert.equal(a.includes(password), false);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
  assert.throws(() => validatePassword('short'), /8–128/);
  assert.equal(username(' QA.User '), 'qa.user'); assert.throws(() => username('ab'), /3–64/);
});

test('session token, cookie and CSRF parsing reject malformed inputs safely', () => {
  const token = newToken(); assert.equal(token.length, 43); assert.equal(tokenHash(token).length, 32);
  assert.equal(readSessionToken('other=1; leinz_session=' + token), token);
  assert.equal(readSessionToken('leinz_session=../../file'), null);
  assert.equal(equalSecret('é'.repeat(64), 'a'.repeat(64)), false);
  assert.equal(equalSecret(['x'], 'x'), false); assert.equal(equalSecret('abc', 'abc'), true);
  assert.match(sessionCookie(token, { sessionHours: 8, secureCookie: true }), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  assert.match(sessionCookie('', { sessionHours: 8, secureCookie: false }, true), /Max-Age=0$/);
});

test('failed login rate limit expires and success clears a user bucket', () => {
  const limiter = new LoginLimiter({ limit: 2, windowMs: 100 });
  assert.equal(limiter.check('one', 1000), true); limiter.fail('one', 1000); limiter.fail('one', 1001);
  assert.equal(limiter.check('one', 1002), false); assert.equal(limiter.check('two', 1002), true);
  assert.equal(limiter.check('one', 1101), true); limiter.fail('one', 1102); limiter.success('one'); assert.equal(limiter.check('one', 1103), true);
});

test('database target rejects unsupported engines and patches', () => {
  assert.equal(checkMysqlVersion('5.7.24'), '5.7.24'); assert.equal(checkMysqlVersion('5.7.44-log'), '5.7.44-log');
  for (const value of ['5.7.23', '8.0.43', '10.11.6-MariaDB', '5.7.24-MariaDB', 'garbage']) assert.throws(() => checkMysqlVersion(value));
});

test('document state retains geometry/frame choices and allows temporarily invalid fit', () => {
  const value = state(); value.heightR = 45;
  assert.deepEqual(validateDocument('state', value, catalogs), value);
  for (const mutate of [s => s.width = 0, s => s.sph = '1', s => s.frameStyle = 'other', s => s.a.index = '1.59', s => s.a.note = 'x'.repeat(801), s => s.camera.zoom = 9]) {
    const invalid = state(); mutate(invalid); assert.throws(() => validateDocument('state', invalid, catalogs));
  }
  assert.equal(validateDocument('state', null, catalogs), null);
});

test('saved consultations reject corrupt choices, duplicate IDs, and oversized history', () => {
  const item = { id: 'saved-one', title: 'Contoh konsultasi', createdAt: new Date().toISOString(), state: state(), data: { choices: [{ index: '1.74', tint: { code: '09S' } }, { index: '1.50', tint: null }] } };
  assert.equal(validateDocument('saved', [item], catalogs).length, 1);
  assert.throws(() => validateDocument('saved', [item, item], catalogs), /berulang/);
  assert.throws(() => validateDocument('saved', [{ ...item, data: { choices: {} } }], catalogs), /dua pilihan/);
  assert.throws(() => validateDocument('saved', Array(31).fill(item), catalogs), /30/);
});

test('master server validation rejects wrong schema and invalid assignments', () => {
  const empty = validateDocument('skus', { schema: 'trl-sku-catalog/1.0', skus: [] }, catalogs);
  assert.deepEqual(empty.skus, []); assert.equal(empty.availabilityMeaning, 'catalog-assignment-not-live-stock');
  assert.throws(() => validateDocument('skus', { schema: 'wrong', skus: [] }, catalogs), /schema/);
  assert.throws(() => validateDocument('skus', { schema: 'trl-sku-catalog/1.0', skus: [{ id: 'sku-one', code: 'ONE', name: 'One', active: true, variants: [{ index: '1.60', enabled: true, power: { sphMin: -10, sphMax: 10, cylMin: -6, cylMax: 0, addMin: 0, addMax: 0 }, assignments: [{ id: 'assignment-one', supplier: 'invalid', productId: 'missing', blankIds: ['missing'] }] }] }] }, catalogs), /bahan baku/);
});

test('JSON prototype keys, infinite numbers and invalid revisions are rejected', () => {
  assert.throws(() => checkJson(JSON.parse('{"__proto__":{"danger":true}}')), /atribut/);
  assert.throws(() => checkJson({ value: Infinity }), /terbatas/);
  for (const value of [-1, .1, '1', null, 4294967295]) assert.throws(() => validateRevision(value));
  assert.equal(validateRevision(0), 0); assert.equal(validateRevision(200), 200);
});

function photochromicState(uvExposure = 70) {
  const value = state(); value.uvExposure = uvExposure;
  value.a.photochromic = true; value.a.tintCode = null;
  value.b.photochromic = false; value.b.tintCode = '09S';
  return value;
}

function photochromicSaved() {
  const value = photochromicState();
  return { id: 'photo-one', title: 'Photochromic UV', createdAt: '2026-11-04T00:00:00.000Z', state: value,
    data: { schema: 'trl-lens-consultation/1.4', preview: { uvExposure: value.uvExposure },
      choices: ['a','b'].map(key=>({ choice: key.toUpperCase(), index: value[key].index,
        tint: value[key].tintCode ? {code:value[key].tintCode} : null,
        photochromic: getAppearance(value[key].photochromic, value.uvExposure) })) } };
}

test('state validation preserves per-pair photochromic and UV, with old states still accepted unchanged', () => {
  const value = photochromicState(), before = structuredClone(value);
  const result = validateDocument('state', value, catalogs);
  assert.deepEqual(result, value);
  assert.deepEqual(value, before);
  result.uvExposure = 1;
  assert.equal(value.uvExposure, 70);
  assert.deepEqual(validateDocument('state', state(), catalogs), state());
  assert.equal(validateDocument('state', photochromicState(0), catalogs).a.photochromic, true);
});

test('server state validation rejects tint on an enabled photochromic pair and malformed exposure or mode', () => {
  for (const mutate of [
    item => { item.a.tintCode = '09S'; },
    item => { item.b.photochromic = true; },
    item => { item.a.photochromic = 'true'; },
    item => { item.b.photochromic = 0; },
    item => { item.uvExposure = -1; },
    item => { item.uvExposure = 100.1; },
    item => { item.uvExposure = '70'; },
    item => { item.uvExposure = null; },
    item => { item.uvExposure = NaN; },
    item => { delete item.uvExposure; }
  ]) {
    const value = photochromicState(); mutate(value);
    assert.throws(() => validateDocument('state', value, catalogs));
  }
});

test('saved photochromic consultations retain one consistent UV snapshot and independent A/B appearance modes', () => {
  const value = photochromicSaved(), before = structuredClone(value);
  const result = validateDocument('saved', [value], catalogs);
  assert.deepEqual(result, [value]);
  assert.deepEqual(value, before);
  assert.equal(result[0].data.choices[0].photochromic.enabled, true);
  assert.equal(result[0].data.choices[1].tint.code, '09S');
});

test('saved consultation snapshots cannot bypass photochromic exclusivity or contradict the stored modes and exposure', () => {
  for (const mutate of [
    item => { item.data.choices[0].tint = { code: '09S' }; },
    item => { item.data.choices[0].photochromic = getAppearance(false, 70); },
    item => { item.data.choices[1].photochromic = getAppearance(true, 70); item.data.choices[1].tint = null; },
    item => { item.data.preview.uvExposure = 50; },
    item => { item.data.preview.uvExposure = '70'; },
    item => { item.data.choices[0].photochromic.uvExposure = 30; },
    item => { item.data.choices[0].photochromic.simulationOnly = false; },
    item => { item.data.choices[1].choice = 'A'; },
    item => { delete item.data.choices[1].photochromic; },
    item => { delete item.data.preview; },
    item => { item.data = { choices: [{ index: '1.74', tint: null }, { index: '1.50', tint: { code: '09S' } }] }; }
  ]) {
    const value = photochromicSaved(); mutate(value);
    assert.throws(() => validateDocument('saved', [value], catalogs));
  }
});

test('imported schema 1.3 history remains valid after UI adds explicit off/zero defaults to its state', () => {
  const value = state(); value.uvExposure = 0; value.a.photochromic = false; value.b.photochromic = false;
  const item = { id: 'legacy-import-one', title: 'Impor konsultasi lama', createdAt: '2026-11-04T00:00:00.000Z', state: value,
    data: { schema: 'trl-lens-consultation/1.3', choices: [{ index: '1.74', tint: { code: '09S' } }, { index: '1.50', tint: null }] } };
  assert.deepEqual(validateDocument('saved', [item], catalogs), [item]);
});

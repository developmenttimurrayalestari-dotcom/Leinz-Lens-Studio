/** Integration tests against a REAL, disposable MySQL 5.7 database.
 * Never points at the normal application database. Explicit opt-in and a
 * leinz_test_* database name are both required before any table is modified.
 */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig, PROJECT_ROOT } from '../server/config.mjs';
import { createPool, migrate, seed, MysqlStore, TABLES, decodeJson, catalogDigest } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';

const require = createRequire(import.meta.url);
const { getAppearance } = require('../dist/photochromic.js');
const { HEADERS, parseCSV, rowsFor, buildMasterImport } = require('../dist/tabular-import.js');
const { MasterUiModel } = require('../dist/master-manager.js');
const BlankEngine = require('../dist/blank-engine.js');

if (process.env.LEINZ_ALLOW_TEST_DB !== '1' || !/^leinz_test_[A-Za-z0-9_]+$/.test(process.env.MYSQL_DATABASE || '')) {
  console.error('Refusing integration tests: set LEINZ_ALLOW_TEST_DB=1 and MYSQL_DATABASE=leinz_test_<disposable_name>. This test resets the Leinz tables in that database.');
  process.exit(2);
}
if (process.argv.slice(2).some(arg => arg !== '--verify-persistence')) throw Error('Unknown test argument.');
const config = loadConfig({ env: { ...process.env, APP_URL: 'http://127.0.0.1:3000', HOST: '127.0.0.1', PORT: '3000' }, envFile: '/nonexistent-leinz-test-env' });
let pool = createPool(config), server, store, origin;
const failures = [], passed = [];
const clone = value => JSON.parse(JSON.stringify(value));
const logs = [];
const appPassword = randomBytes(24).toString('base64url');
const secondPassword = randomBytes(24).toString('base64url');

async function test(name, run) {
  try { await run(); passed.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function cli(command, env = {}) {
  const child = spawn(process.execPath, ['server/cli.mjs', command], {
    cwd: PROJECT_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert(!stdout.includes(appPassword) && !stderr.includes(appPassword), 'CLI must never print the app password');
  assert(!stdout.includes(config.mysql.password) && !stderr.includes(config.mysql.password), 'CLI must never print the database password');
  return { code, stdout, stderr };
}
async function startApp() {
  store = new MysqlStore(pool, config); await store.initialize();
  server = createApp({ store, config, logger: { error: (...args) => logs.push(args.join(' ')) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`; config.origin = origin;
}
async function stopApp() {
  if (!server) return;
  const value = server; server = null;
  value.closeAllConnections(); await new Promise((resolve, reject) => value.close(error => error ? reject(error) : resolve()));
}
async function request(path, { method = 'GET', body, rawBody, cookie, csrf, headers = {} } = {}) {
  const data = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
  const merged = { ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { Origin: origin } : {}),
    ...(data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers };
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin, { method, path, headers: merged }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const bytes = Buffer.concat(chunks), text = bytes.toString('utf8'); let json;
        try { json = JSON.parse(text); } catch { /* static files are not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, bytes, text, json });
      });
    });
    req.setTimeout(10000, () => req.destroy(Error('HTTP test timed out')));
    req.on('error', reject); req.end(data);
  });
}
async function login(username, password) {
  const res = await request('/api/session', { method: 'POST', body: { username, password } });
  assert.equal(res.status, 200, res.text); assert.equal(res.json.authenticated, true);
  assert.match(res.headers['set-cookie'][0], /HttpOnly/); assert.match(res.headers['set-cookie'][0], /SameSite=Strict/);
  assert(!res.headers['set-cookie'][0].includes('Secure'), 'Loopback HTTP test cookie must be usable');
  return { cookie: res.headers['set-cookie'][0].split(';')[0], csrf: res.json.csrfToken, user: res.json.user };
}
async function getDoc(key, actor) { const res = await request(`/api/documents/${key}`, actor); assert.equal(res.status, 200, res.text); return res.json; }
async function putDoc(key, value, revision, actor) { return request(`/api/documents/${key}`, { method: 'PUT', body: { value, revision }, ...actor }); }

try {
  const [[info]] = await pool.query('SELECT VERSION() AS version, @@sql_mode AS sqlMode, @@max_allowed_packet AS maxPacket');
  assert.match(info.version, /^5\.7\./); assert(!/mariadb/i.test(info.version));
  console.log(JSON.stringify({ databaseVersion: info.version, sqlMode: info.sqlMode, maxAllowedPacket: Number(info.maxPacket), testDatabase: config.mysql.database }));
  if (process.argv.includes('--verify-persistence')) {
    await test('Database restart preserves state, history, SKU and all managed master catalogs', async () => {
      await startApp();
      const [users] = await pool.execute('SELECT id FROM leinz_users WHERE username = ?', ['qaadmin']);
      assert.equal(users.length, 1);
      const state = await store.getDocument(Number(users[0].id), 'state');
      assert.equal(state.value.a.note, 'QA restart marker 👓');
      const history = await store.getDocument(Number(users[0].id), 'saved');
      assert.equal(history.value.length, 1); assert.equal(history.value[0].id, 'qa-saved-1');
      const skus = await store.getDocument(null, 'skus');
      assert.equal(skus.value.skus.length, 3); assert.equal(skus.value.skus[0].code, "LEINZ'57");
      const catalogs = await store.getCatalogs();
      assert.equal(catalogs.value.materials.products.length, 92); assert.equal(catalogs.value.materials.blanks.length, 797);
      assert.equal(catalogs.value.materials.rules.length, 6830); assert.equal(catalogs.value.shapes.items.length, 14); assert.equal(catalogs.value.tints.items.length, 67);
      assert.equal(catalogs.value.materials.products.find(p=>p.id==='QA:MANAGED').opticalProfile.minCenterMm,1.2);
      assert.equal(catalogs.value.tints.items.find(t=>t.code==='QA-TINT').active,false);
      assert.equal(state.value.optics.profile.minCenterMm,1.2);
      assert.equal((await request('/api/health')).json.databaseVersion, info.version);
    });
  } else {
    // The guard above is intentionally before the first destructive statement.
    for (const name of [...TABLES].reverse()) await pool.query(`DROP TABLE IF EXISTS \`${name}\``);
    await test('Fresh installation: migration and seeding CLIs are repeatable', async () => {
      for (const command of ['migrate', 'migrate', 'seed', 'seed']) {
        const result = await cli(command); assert.equal(result.code, 0, result.stderr);
      }
      const [tables] = await pool.query('SHOW TABLES'); assert.equal(tables.length, TABLES.length);
      const [[migration]] = await pool.query('SELECT COUNT(*) AS n FROM leinz_schema_migrations'); assert.equal(Number(migration.n), 4);
      const [columns] = await pool.query("SELECT DATA_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'document_json'");
      assert.equal(columns.length, 3); assert(columns.every(c => c.type === 'json'));
    });
    await test('Account installation and diagnostic CLI; duplicate account is preserved', async () => {
      const missingUser = await cli('doctor'); assert.equal(missingUser.code, 1);
      const first = await cli('admin-create', { ADMIN_USERNAME: 'qaadmin', ADMIN_PASSWORD: appPassword }); assert.equal(first.code, 0, first.stderr);
      const second = await cli('admin-create', { ADMIN_USERNAME: 'qaother', ADMIN_PASSWORD: secondPassword }); assert.equal(second.code, 0, second.stderr);
      const duplicate = await cli('admin-create', { ADMIN_USERNAME: 'qaadmin', ADMIN_PASSWORD: 'MustNotReplaceThisPassword' }); assert.equal(duplicate.code, 1);
      const doctor = await cli('doctor'); assert.equal(doctor.code, 0, doctor.stderr); assert.equal(JSON.parse(doctor.stdout).databaseVersion, info.version);
      const [users] = await pool.query('SELECT password_hash FROM leinz_users'); assert.equal(users.length, 2); assert(users.every(user => user.password_hash.startsWith('scrypt$1$')));
    });
    await startApp();
    await test('Unauthenticated API and raw catalog reads are rejected', async () => {
      assert.deepEqual((await request('/api/session')).json, { authenticated: false });
      for (const path of ['/api/bootstrap', '/api/catalogs', '/api/documents/state', '/api/documents/saved', '/api/documents/skus', '/assets/materials.json', '/assets//materials.json', '/assets/%2Fmaterials.json', '/assets//tints.json']) assert.equal((await request(path)).status, 401, path);
      const health = await request('/api/health'); assert.equal(health.status, 200); assert.equal(health.json.databaseVersion, info.version);
    });
    await test('Login rejects wrong passwords, injected usernames and foreign origins', async () => {
      for (const body of [{ username: 'qaadmin', password: 'wrong' }, { username: "qaadmin' OR 1=1 --", password: appPassword }]) assert.equal((await request('/api/session', { method: 'POST', body })).status, 401);
      assert.equal((await request('/api/session', { method: 'POST', body: { username: 'qaadmin', password: appPassword }, headers: { Origin: 'https://unrelated.invalid' } })).status, 403);
    });
    let admin = await login('QAADMIN', appPassword), other = await login('qaother', secondPassword);
    let bootstrap, state, skuCatalog;
    await test('Authenticated bootstrap loads all catalogs from MySQL', async () => {
      const res = await request('/api/bootstrap', admin); assert.equal(res.status, 200, res.text); bootstrap = res.json;
      assert.equal(bootstrap.catalogs.tints.items.length, 66); assert.equal(bootstrap.catalogs.shapes.items.length, 13);
      assert.equal(bootstrap.catalogs.materials.blanks.length, 796); assert.equal(bootstrap.catalogs.materials.products.length, 91);
      assert.equal(bootstrap.catalogs.materials.rules.length, 6829);
      assert(bootstrap.catalogs.materials.products.some(p=>p.index==='1.59'&&!p.activeForSimulator));
      assert(Number.isInteger(bootstrap.catalogRevision));
      for(const key of ['materials','shapes','tints']) {
        const asset=JSON.parse(readFileSync(resolve(PROJECT_ROOT,`dist/assets/${key}.json`),'utf8'));
        assert.equal(catalogDigest(bootstrap.catalogs[key]),catalogDigest(asset),key+' persisted content must match the complete asset catalog');
      }
      console.log(JSON.stringify({referenceCatalogs:{products:91,blanks:796,powerRules:6829,frameShapes:13,tinting:66,catalogOnlyIndex159Preserved:true},canonicalSha256:Object.fromEntries(['materials','shapes','tints'].map(key=>[key,catalogDigest(bootstrap.catalogs[key])]))}));
      const current = await request('/api/catalogs',admin);assert.equal(current.status,200);assert.equal(current.json.revision,bootstrap.catalogRevision);assert.deepEqual(current.json.value,bootstrap.catalogs);
      assert.equal(bootstrap.documents.state.value, null); assert.deepEqual(bootstrap.documents.saved.value, []); assert.deepEqual(bootstrap.documents.skus.value.skus, []);
      const [[sessions]] = await pool.query('SELECT COUNT(*) AS n FROM leinz_sessions WHERE LENGTH(token_hash) = 32'); assert.equal(Number(sessions.n), 2);
      const cam = { yaw: -.62, pitch: .12, zoom: 1 };
      state = { active: 'a', shape: '001', width: 52, height: 38, dbl: 18, sph: -4, cyl: -1, axis: 180, add: 0,
        pdR: 31.5, pdL: 31.5, heightR: 19, heightL: 19, allowanceDiameter: 2, sync: true, showFrame: true, showTemples: true, frameStyle: 'full-rim', camera: cam,
        a: { index: '1.74', productId: 'DMO:SPHW74', skuId: null, blankIdR: null, blankIdL: null, tintCode: '09S', customColor: '#9b7965', note: '', camera: cam },
        b: { index: '1.50', productId: 'SOA:SPHW50', skuId: null, blankIdR: null, blankIdL: null, tintCode: '09S', customColor: '#9b7965', note: '', camera: cam } };
    });
    await test('CSRF, Unicode CSRF and wrong Origin cannot mutate documents', async () => {
      const body = { value: state, revision: 0 };
      for (const params of [{ cookie: admin.cookie }, { ...admin, csrf: 'x'.repeat(64) }, { ...admin, csrf: 'é'.repeat(64) }, { ...admin, headers: { Origin: 'http://wrong.invalid' } }]) {
        const res = await request('/api/documents/state', { method: 'PUT', body, ...params }); assert.equal(res.status, 403, res.text);
      }
      assert.equal((await getDoc('state', admin)).revision, 0);
      const current=(await request('/api/catalogs',admin)).json;
      assert.equal((await request('/api/catalogs',{method:'PUT',body:{value:current.value,revision:current.revision},cookie:admin.cookie})).status,403);
      assert.equal((await request('/api/catalogs',{method:'PUT',body:{value:current.value,revision:current.revision},...admin,headers:{Origin:'http://wrong.invalid'}})).status,403);
      assert.equal((await request('/api/catalogs',admin)).json.revision,current.revision);
    });
    await test('State round-trip preserves frame/tint/centration settings and Unicode', async () => {
      state.a.note = 'Café 👓 / <script>not executable</script> / apostrophe: \' '; state.frameStyle = 'half-rimless'; state.showTemples = false;
      const res = await putDoc('state', state, 0, admin); assert.equal(res.status, 200, res.text); assert.equal(res.json.revision, 1);
      assert.deepEqual((await getDoc('state', admin)).value, state);
    });
    await test('Per-user state/history isolation and query-parameter spoof protection', async () => {
      const mine = await getDoc('state', other); assert.equal(mine.value, null); assert.equal(mine.revision, 0);
      const res = await request(`/api/documents/state?userId=${admin.user.id}`, other); assert.equal(res.status, 200); assert.equal(res.json.value, null);
    });
    await test('Stale writes return 409 with current document; concurrent CAS has one winner', async () => {
      const stale = await putDoc('state', { ...state, width: 53 }, 0, admin); assert.equal(stale.status, 409); assert.equal(stale.json.error.code, 'revision_conflict'); assert.equal(stale.json.document.revision, 1);
      const races = await Promise.all([putDoc('state', { ...state, width: 54 }, 1, admin), putDoc('state', { ...state, width: 55 }, 1, admin)]);
      assert.deepEqual(races.map(r => r.status).sort(), [200, 409]); assert.equal((await getDoc('state', admin)).revision, 2);
    });
    await test('Photochromic state and UV round-trip; simultaneous tint is rejected without database mutation', async () => {
      const previous = await getDoc('state', admin), next = clone(previous.value);
      next.uvExposure = 65; next.a.photochromic = true; next.a.tintCode = null; next.b.photochromic = false;
      try {
        const write = await putDoc('state', next, previous.revision, admin);
        assert.equal(write.status, 200, write.text);
        assert.deepEqual((await getDoc('state', admin)).value, next);
        const [[row]] = await pool.execute('SELECT document_json, revision FROM leinz_user_documents WHERE user_id = ? AND document_key = ?', [admin.user.id, 'state']);
        assert.equal(decodeJson(row.document_json), null, 'Legacy draft JSON remains the original backup.');
        const [[typed]] = await pool.execute('SELECT uv_exposure FROM leinz_rel_states WHERE document_id=?',[`user:${admin.user.id}:state`]);
        assert.equal(typed.uv_exposure,next.uvExposure);
        assert.equal(Number(row.revision), write.json.revision);
        const conflicting = clone(next); conflicting.a.tintCode = '09S';
        const rejected = await putDoc('state', conflicting, write.json.revision, admin);
        assert.equal(rejected.status, 422, rejected.text);
        assert.match(rejected.json.error.message, /TransActiv.*tinting/i);
        assert.deepEqual(await getDoc('state', admin), write.json, 'A rejected tint must not advance the state revision or change its value.');
      } finally {
        const current = await getDoc('state', admin);
        if (current.revision !== previous.revision) {
          const restored = await putDoc('state', previous.value, current.revision, admin);
          assert.equal(restored.status, 200, restored.text);
          assert.deepEqual(restored.json.value, previous.value);
        }
      }
    });
    await test('SKU master supports all allowed indices, quoted/Unicode codes and shared access', async () => {
      const materials = bootstrap.catalogs.materials;
      const variants = ['1.50', '1.56', '1.57', '1.60', '1.67', '1.74'].map((index, i) => {
        const product = materials.products.find(p => p.activeForSimulator && p.index === index && materials.blanks.some(b => b.productId === p.id));
        assert(product, `Missing actual product ${index}`);
        const blank = materials.blanks.find(b => b.productId === product.id);
        return { index, enabled: true, power: { sphMin: -20, sphMax: 12, cylMin: -7, cylMax: 0, addMin: 0, addMax: 4 }, assignments: [{ id: `qa-assignment-${i}`, supplier: product.supplier, productId: product.id, blankIds: [blank.id] }] };
      });
      skuCatalog = { schema: 'trl-sku-catalog/1.0', skus: ["LEINZ'57", 'CAFE', 'CAFÉ'].map((code, i) => ({ id: `qa-sku-${i}`, code, name: `Produk Café 👓 ${i}`, active: true, variants: clone(variants), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) };
      const res = await putDoc('skus', skuCatalog, 0, admin); assert.equal(res.status, 200, res.text); assert.equal(res.json.revision, 1);
      assert.deepEqual((await getDoc('skus', other)).value.skus.map(s => s.code), ["LEINZ'57", 'CAFE', 'CAFÉ']);
    });
    await test('Invalid supplier/blank/range/duplicate SKU is rejected without data loss', async () => {
      const invalid = [];
      let item = clone(skuCatalog); item.skus[0].variants[0].assignments[0].supplier = 'INVALID'; invalid.push(item);
      item = clone(skuCatalog); item.skus[0].variants[0].assignments[0].blankIds = ['missing-blank']; invalid.push(item);
      item = clone(skuCatalog); item.skus[0].variants[0].power.cylMax = 1; invalid.push(item);
      item = clone(skuCatalog); item.skus[1].code = item.skus[0].code.toLowerCase(); invalid.push(item);
      for (const value of invalid) { const res = await putDoc('skus', value, 1, admin); assert.equal(res.status, 422, res.text); }
      assert.equal((await getDoc('skus', admin)).revision, 1);
    });
    await test('Consultation history round-trip, malformed entries and duplicate IDs', async () => {
      const entry = { id: 'qa-saved-1', title: 'Konsultasi Café 👓', createdAt: new Date().toISOString(), state: clone(state), data: { choices: [{ index: '1.74', tint: null }, { index: '1.50', tint: null }] } };
      const res = await putDoc('saved', [entry], 0, admin); assert.equal(res.status, 200, res.text);
      assert.deepEqual((await getDoc('saved', admin)).value, [entry]); assert.deepEqual((await getDoc('saved', other)).value, []);
      for (const value of [[{ ...entry, data: { choices: 'wrong' } }], [entry, entry], Array.from({ length: 31 }, (_, i) => ({ ...entry, id: `qa-${i}` }))]) assert.equal((await putDoc('saved', value, 1, admin)).status, 422);
      assert.equal((await getDoc('saved', admin)).revision, 1);
    });
    await test('Schema 1.4 photochromic history persists UV and rejects conflicting snapshot tint', async () => {
      const previous = await getDoc('saved', admin), photoState = clone(state);
      photoState.uvExposure = 65; photoState.a.photochromic = true; photoState.a.tintCode = null; photoState.b.photochromic = false;
      const entry = { id: 'qa-photochromic-14', title: 'Photochromic A / tint B · UV 65%', createdAt: new Date().toISOString(), state: photoState,
        data: { schema: 'trl-lens-consultation/1.4', preview: { uvExposure: 65 },
          choices: ['a','b'].map(key=>({ choice: key.toUpperCase(), index: photoState[key].index,
            tint: photoState[key].tintCode ? { code: photoState[key].tintCode } : null,
            photochromic: getAppearance(photoState[key].photochromic, 65) })) } };
      try {
        const write = await putDoc('saved', [entry, ...previous.value], previous.revision, admin);
        assert.equal(write.status, 200, write.text);
        assert.deepEqual((await getDoc('saved', admin)).value, [entry, ...previous.value]);
        const [[row]] = await pool.execute('SELECT document_json FROM leinz_user_documents WHERE user_id = ? AND document_key = ?', [admin.user.id, 'saved']);
        assert.deepEqual(decodeJson(row.document_json), [], 'Legacy history JSON remains the original backup.');
        for (const mutate of [
          value => { value.data.choices[0].tint = { code: '09S' }; },
          value => { value.data.choices[0].photochromic.uvExposure = 60; },
          value => { value.data.choices[0].photochromic = getAppearance(false, 65); }
        ]) {
          const conflicting = clone(entry); mutate(conflicting);
          const rejected = await putDoc('saved', [conflicting, ...previous.value], write.json.revision, admin);
          assert.equal(rejected.status, 422, rejected.text);
          assert.deepEqual(await getDoc('saved', admin), write.json, 'A rejected snapshot must preserve both history and revision.');
        }
        assert.deepEqual((await getDoc('saved', other)).value, [], 'Photochromic history must remain scoped to its account.');
      } finally {
        const current = await getDoc('saved', admin);
        if (current.revision !== previous.revision) {
          const restored = await putDoc('saved', previous.value, current.revision, admin);
          assert.equal(restored.status, 200, restored.text);
          assert.deepEqual(restored.json.value, previous.value);
        }
      }
    });
    await test('Legacy schema 1.3 history remains valid with explicit photochromic off and zero UV defaults', async () => {
      const previous = await getDoc('saved', admin), entry = clone(previous.value[0]);
      entry.id = 'qa-legacy-13-import'; entry.data.schema = 'trl-lens-consultation/1.3';
      entry.state.uvExposure = 0; entry.state.a.photochromic = false; entry.state.b.photochromic = false;
      try {
        const write = await putDoc('saved', [entry, ...previous.value], previous.revision, admin);
        assert.equal(write.status, 200, write.text);
        assert.deepEqual((await getDoc('saved', admin)).value[0], entry);
        assert.equal(write.json.value[0].state.a.tintCode, entry.state.a.tintCode);
        assert.equal(write.json.value[0].data.choices[0].photochromic, undefined, 'An original 1.3 snapshot need not invent 1.4 metadata.');
      } finally {
        const current = await getDoc('saved', admin);
        if (current.revision !== previous.revision) {
          const restored = await putDoc('saved', previous.value, current.revision, admin);
          assert.equal(restored.status, 200, restored.text);
          assert.deepEqual(restored.json.value, previous.value);
        }
      }
    });
    await test('CSV import replaces only the touched blank coverage and preserves joint power rules in MySQL', async () => {
      const previous = (await request('/api/catalogs', admin)).json, skus = (await getDoc('skus', admin)).value;
      const material = previous.value.materials.products.find(value=>value.id==='DMO:SPHG60');
      const blank = previous.value.materials.blanks.find(value=>value.productId===material.id&&value.baseCurve===1&&value.diameter===75);
      assert.ok(material && blank, 'The audited DMO/SPHG60 BC1 Ø75 fixture must exist.');
      const base = [material.supplier, material.code, material.name, blank.baseCurve, blank.diameter, blank.ct, blank.et];
      const first = [...base, -9, -8, -3, 0, 0, 0], second = [...base, -9, -8, 0, 0, 1, 2];
      const cell = value => '"' + String(value).replace(/"/g, '""') + '"';
      const csv = [HEADERS.materials, first, second, first].map(row=>row.map(cell).join(',')).join('\r\n') + '\r\n';
      const parsed = parseCSV(csv, { filename: 'qa-touched-blank.csv' });
      const imported = buildMasterImport(previous.value, parsed, { kind: 'materials', skuCatalog: skus, now: '2026-11-04T00:00:00.000Z' });
      const plan = MasterUiModel.importPlan(previous.value, imported.payload, { skuCatalog: skus });
      assert.equal(imported.info.touchedBlanks, 1); assert.equal(imported.info.duplicateRows, 1); assert.equal(imported.info.uniqueRecords, 2);
      assert.equal(plan.changed, true);
      assert.deepEqual(plan.value.materials.products, previous.value.materials.products);
      assert.deepEqual(plan.value.materials.blanks, previous.value.materials.blanks);
      assert.deepEqual(plan.value.materials.rules.filter(rule=>rule.blankId!==blank.id), previous.value.materials.rules.filter(rule=>rule.blankId!==blank.id));
      assert.deepEqual(plan.value.shapes, previous.value.shapes); assert.deepEqual(plan.value.tints, previous.value.tints);
      const frame = BlankEngine.estimateFrame({ ...state, points: previous.value.shapes.items.find(shape=>shape.code===state.shape).points });
      assert.equal(frame.valid, true);
      try {
        const write = await request('/api/catalogs', { method: 'PUT', body: { value: plan.value, revision: previous.revision }, ...admin });
        assert.equal(write.status, 200, write.text);
        const saved = (await request('/api/catalogs', other)).json;
        assert.deepEqual(saved, write.json);
        assert.equal(saved.value.materials.rules.filter(rule=>rule.blankId===blank.id).length, 2);
        for (const [rx, expected] of [[{sph:-8.5,cyl:-2,add:0},true], [{sph:-8.5,cyl:0,add:1.5},true], [{sph:-8.5,cyl:-2,add:1.5},false], [{sph:-9,cyl:-4,add:0},false]]) {
          const result = BlankEngine.evaluate({ materials: saved.value.materials, index: material.index, productId: material.id, rx, frame });
          const candidate = result.rows.find(row=>row.blank.id===blank.id);
          assert.equal(candidate.rawPowerMatches, expected, 'Stored range rows must remain AND within a row / OR across rows.');
          assert.equal(candidate.eligibleBoth, expected);
        }
        const repeat = buildMasterImport(saved.value, parsed, { kind: 'materials', skuCatalog: skus });
        assert.equal(MasterUiModel.importPlan(saved.value, repeat.payload, { skuCatalog: skus }).changed, false, 'Reimporting identical coverage must be idempotent.');
        assert.deepEqual((await getDoc('skus', admin)).value, skus, 'Importing coverage must preserve SKU and blank assignment identities.');
        const invalid = clone(saved.value); invalid.materials.rules.find(rule=>rule.blankId===blank.id).cylFrom = 1;
        const rejected = await request('/api/catalogs', { method: 'PUT', body: { value: invalid, revision: saved.revision }, ...admin });
        assert.equal(rejected.status, 422, rejected.text);
        assert.deepEqual((await request('/api/catalogs', admin)).json, saved);
      } finally {
        const current = (await request('/api/catalogs', admin)).json;
        if (current.revision !== previous.revision) {
          const restored = await request('/api/catalogs', { method: 'PUT', body: { value: previous.value, revision: current.revision }, ...admin });
          assert.equal(restored.status, 200, restored.text);
          assert.deepEqual(restored.json.value, previous.value);
        }
      }
    });
    await test('Migration from the six-table 2.0 schema preserves existing catalogs, accounts, SKU and consultations', async () => {
      const catalogs=(await request('/api/catalogs',admin)).json.value;
      const before={state:await getDoc('state',admin),saved:await getDoc('saved',admin),skus:await getDoc('skus',admin)};
      const [usersBefore]=await pool.query('SELECT id, username, password_hash, active FROM leinz_users ORDER BY id');
      // Construct the actual pre-normalization JSON schema using current values.
      for(const key of ['materials','shapes','tints']) await pool.execute('UPDATE leinz_catalog_documents SET document_json=? WHERE document_key=?',[JSON.stringify(catalogs[key]),key]);
      await pool.execute("UPDATE leinz_workspace_documents SET document_json=? WHERE document_key='skus'",[JSON.stringify(before.skus.value)]);
      for(const user of usersBefore) for(const key of ['state','saved']) {
        const doc=await store.getDocument(user.id,key);
        await pool.execute('UPDATE leinz_user_documents SET document_json=? WHERE user_id=? AND document_key=?',[JSON.stringify(doc.value),user.id,key]);
      }
      for(const name of [...TABLES].reverse().filter(name=>name.startsWith('leinz_rel_'))) await pool.query(`DROP TABLE \`${name}\``);
      await pool.query('DROP TABLE leinz_catalog_revision');
      await pool.query('DELETE FROM leinz_schema_migrations WHERE version IN (2,3,4)');
      const migration=await cli('migrate');assert.equal(migration.code,0,migration.stderr);
      await seed(pool);await seed(pool);
      for(const key of ['state','saved','skus'])assert.deepEqual(await getDoc(key,admin),before[key]);
      assert.deepEqual((await request('/api/catalogs',admin)).json.value,catalogs);
      const [usersAfter]=await pool.query('SELECT id, username, password_hash, active FROM leinz_users ORDER BY id');assert.deepEqual(usersAfter,usersBefore);
      const doctor=await cli('doctor');assert.equal(doctor.code,0,doctor.stderr);const report=JSON.parse(doctor.stdout);
      assert.equal(report.schemaVersion,5);assert.equal(report.tables,TABLES.length);
      assert.deepEqual(report.masterCounts,{products:91,blanks:796,powerRules:6829,frameShapes:13,tinting:66,skus:3});
      for(const key of ['materials','shapes','tints'])assert.equal(report.catalogContentSha256[key],catalogDigest(catalogs[key]));
    });
    await test('Manage CRUD writes all catalog types atomically and a second store reads fresh MySQL data', async () => {
      const secondStore=new MysqlStore(pool,config);await secondStore.initialize();
      const current=(await request('/api/catalogs',admin)).json,next=clone(current.value);
      const opticalProfile={minCenterMm:1.2,minEdgeMm:1.5,frontPowerD:4,frontCurveBasis:'material',curveReferenceIndex:1.53,frontConic:0,backConic:0,source:'lab',reference:'QA supplied parameter; not production verification'};
      next.materials.products.push({id:'QA:MANAGED',supplier:'QA',code:'MANAGED',name:'Bahan Café 👓',index:'1.60',activeForSimulator:true,active:true,opticalProfile});
      next.materials.blanks.push({id:'QA:MANAGED:80',productId:'QA:MANAGED',baseCurve:4,diameter:80,ct:8,et:12,active:true,opticalProfile:{...opticalProfile,frontRadiusMm:150}});
      next.materials.rules.push({id:'qa-managed-rule',blankId:'QA:MANAGED:80',sphFrom:-10,sphTo:8,cylFrom:-6,cylTo:0,addFrom:0,addTo:4,source:'managed',sourceRows:[],exactDuplicateCount:0,hasExactDuplicates:false});
      next.shapes.items.push({code:'qa-square',name:'QA Square',category:'additional',source:'managed',points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],defaultWidthMm:52,defaultHeightMm:40,contourMode:'vector',active:true});
      next.tints.items.push({code:'QA-TINT',name:'QA Blue',kind:'Gradient',group:'fashion',nominalPercent:null,previewHex:'#123456',previewMidHex:null,previewBottomHex:'#FFFFFF',referenceStatus:'manual',referenceNote:'Contoh pengguna Café 👓',active:true});
      const write=await request('/api/catalogs',{method:'PUT',body:{value:next,revision:current.revision},...admin});assert.equal(write.status,200,write.text);assert.equal(write.json.revision,current.revision+1);
      assert.deepEqual((await secondStore.getCatalogs()).value,next);
      for(const key of ['materials','shapes','tints']){
        const download=await request(`/assets/${key}.json`,admin);assert.equal(download.status,200);assert.deepEqual(download.json,next[key]);
      }
      const otherBootstrap=await request('/api/bootstrap',other);assert.equal(otherBootstrap.status,200);assert.deepEqual(otherBootstrap.json.catalogs,next);assert.equal(otherBootstrap.json.catalogRevision,write.json.revision);
      const skus=await getDoc('skus',admin),updated=clone(skus.value);
      updated.skus[0].variants.find(v=>v.index==='1.60').assignments.push({id:'qa-managed-assignment',supplier:'QA',productId:'QA:MANAGED',blankIds:['QA:MANAGED:80']});
      const skuWrite=await putDoc('skus',updated,skus.revision,admin);assert.equal(skuWrite.status,200,skuWrite.text);
      assert((await getDoc('skus',other)).value.skus[0].variants.find(v=>v.index==='1.60').assignments.some(a=>a.productId==='QA:MANAGED'));
    });
    await test('Invalid catalog edits, identity deletion, geometry and assigned-blank reassignment preserve all rows', async () => {
      const current=(await request('/api/catalogs',admin)).json;
      const mutations=[v=>v.materials.blanks[0].diameter=-1,v=>v.materials.products.pop(),v=>v.shapes.items[0].points=[[0,0],[.5,.5],[-.5,.5],[.5,-.5]],v=>v.tints.items[0].previewHex='invalid',v=>v.materials.blanks.find(b=>b.id==='QA:MANAGED:80').productId=v.materials.products[0].id,v=>v.materials.products.find(p=>p.id==='QA:MANAGED').opticalProfile.frontConic=-1];
      for(const mutate of mutations){const next=clone(current.value);next.shapes.items[1].name='Must not commit';mutate(next);const res=await request('/api/catalogs',{method:'PUT',body:{value:next,revision:current.revision},...admin});assert.equal(res.status,422,res.text);assert.deepEqual((await request('/api/catalogs',admin)).json,current);}
    });
    await test('A database failure during the last catalog update rolls back earlier updates and revision', async () => {
      const current=(await request('/api/catalogs',admin)).json,next=clone(current.value);next.materials.products[0].name='Must roll back';next.shapes.items[1].name='Must roll back too';
      await pool.query("CREATE TRIGGER qa_fail_catalog_write BEFORE UPDATE ON leinz_catalog_documents FOR EACH ROW BEGIN IF NEW.document_key = 'tints' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA simulated transactional failure'; END IF; END");
      try{
        const res=await request('/api/catalogs',{method:'PUT',body:{value:next,revision:current.revision},...admin});assert.equal(res.status,503);assert.equal(res.json.error.code,'service_unavailable');assert(!res.text.includes('QA simulated')&&!res.text.includes('UPDATE'));
        assert.deepEqual((await request('/api/catalogs',admin)).json,current);
      }finally{await pool.query('DROP TRIGGER qa_fail_catalog_write');}
    });
    await test('Concurrent master edits have one winner and stale revision returns the complete latest bundle', async () => {
      const current=(await request('/api/catalogs',admin)).json;
      const variants=['A','B'].map(suffix=>{const value=clone(current.value);value.materials.products.find(p=>p.id==='QA:MANAGED').name='QA concurrent '+suffix;return value;});
      const results=await Promise.all(variants.map(value=>request('/api/catalogs',{method:'PUT',body:{value,revision:current.revision},...admin})));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const latest=(await request('/api/catalogs',admin)).json;assert.equal(latest.revision,current.revision+1);
      assert.deepEqual(results.find(r=>r.status===409).json.document,latest);
    });
    await test('Archives remain referenced, reseeding preserves managed edits and finished optical settings persist', async () => {
      const current=(await request('/api/catalogs',admin)).json,next=clone(current.value);
      next.materials.products.find(p=>p.id==='QA:MANAGED').active=false;next.materials.blanks.find(b=>b.id==='QA:MANAGED:80').active=false;
      next.shapes.items.find(s=>s.code==='qa-square').active=false;next.tints.items.find(t=>t.code==='QA-TINT').active=false;
      const written=await request('/api/catalogs',{method:'PUT',body:{value:next,revision:current.revision},...admin});assert.equal(written.status,200,written.text);
      await seed(pool);await seed(pool);assert.deepEqual((await request('/api/catalogs',admin)).json,written.json);
      state.optics={useOverride:true,profile:{minCenterMm:1.2,minEdgeMm:1.5,frontPowerD:4,frontCurveBasis:'material',frontConic:0,backConic:0,source:'assumption',reference:'QA override'}};
      const stateDoc=await getDoc('state',admin);const saved=await putDoc('state',state,stateDoc.revision,admin);assert.equal(saved.status,200,saved.text);
      assert.deepEqual((await getDoc('state',admin)).value.optics,state.optics);
      for(const profile of [{minCenterMm:.1},{frontConic:-1},{source:'lab',reference:''}])assert.equal((await putDoc('state',{...state,optics:{useOverride:true,profile}},saved.json.revision,admin)).status,422);
      const refreshed=new MysqlStore(pool,config);await refreshed.initialize();assert.equal((await refreshed.getCatalogs()).value.materials.products.find(p=>p.id==='QA:MANAGED').active,false);
    });
    await test('Malformed JSON, invalid state/revision, prototype keys and oversize bodies fail safely', async () => {
      assert.equal((await request('/api/documents/state', { method: 'PUT', rawBody: '{', ...admin })).status, 400);
      assert.equal((await request('/api/documents/state', { method: 'PUT', rawBody: '[]', ...admin })).status, 400);
      assert.equal((await request('/api/documents/state', { method: 'PUT', body: {}, ...admin, headers: { 'Content-Type': 'text/plain' } })).status, 415);
      const revision=(await getDoc('state',admin)).revision;
      assert.equal((await request('/api/documents/state', { method: 'PUT', rawBody: '{"value":null,"revision":2,"__proto__":{"polluted":true}}', ...admin })).status, 422);
      assert.equal((await putDoc('state', { ...state, width: 500 }, revision, admin)).status, 422);
      assert.equal((await putDoc('state', state, '2', admin)).status, 422);
      assert.equal((await request('/api/documents/state', { method: 'PUT', body: { value: 'x'.repeat(8 * 1024 * 1024 + 1), revision: 2 }, ...admin })).status, 413);
      assert.equal((await getDoc('state', admin)).revision, revision);
    });
    await test('Static server exposes UI only; source, secrets and traversal are blocked', async () => {
      const page = await request('/'); assert.equal(page.status, 200); assert.match(page.headers['content-type'], /text\/html/);
      assert.match(page.headers['content-security-policy'], /object-src 'none'/);
      const runtime = await request('/runtime-config.js'); assert.equal(runtime.status, 200); assert.match(runtime.text, /"mode":"mysql"/); assert(!runtime.text.includes(config.mysql.password));
      const doubleSlashRuntime = await request('//runtime-config.js'); assert.equal(doubleSlashRuntime.status, 200); assert.match(doubleSlashRuntime.text, /"mode":"mysql"/);
      for (const path of ['/.env', '/server/config.mjs', '/database/001_initial.sql', '/package.json', '/%2e%2e%2f.env', '/%2e%2e%2fserver%2fconfig.mjs']) assert.equal((await request(path)).status, 404, path);
      for (const path of ['/%00', '/%GG', '/%5c.env']) assert.equal((await request(path)).status, 400, path);
      assert.equal((await request('/api/documents/unknown', admin)).status, 404);
      assert.equal((await request('/api/documents/state', { method: 'POST', body: {}, ...admin })).status, 405);
      const head = await request('/index.html', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.text, '');
    });
    await test('All eight CSV and Excel templates support exact-byte GET and empty-body HEAD with correct MIME types', async () => {
      for (const [kind, name] of [['materials','blank'], ['shapes','frame-shape'], ['tints','tinting'], ['skus','sku']]) {
        for (const extension of ['csv','xlsx']) {
          const path = `/templates/${name}-template.${extension}`;
          const expected = readFileSync(resolve(PROJECT_ROOT, 'dist', path.slice(1)));
          const type = extension === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const get = await request(path);
          assert.equal(get.status, 200, path);
          assert.equal(get.headers['content-type'], type, path);
          assert.equal(Number(get.headers['content-length']), expected.length, path);
          assert.equal(get.headers['x-content-type-options'], 'nosniff', path);
          assert.deepEqual(get.bytes, expected, `${path}: download bytes must equal the validated template.`);
          if (extension === 'csv') assert.ok(rowsFor(parseCSV(get.text, { filename: `${name}-template.csv` }), kind).length > 0, path);
          else assert.deepEqual([...get.bytes.subarray(0,4)], [0x50,0x4B,0x03,0x04], `${path}: XLSX must remain a binary ZIP container.`);
          const head = await request(path, { method: 'HEAD' });
          assert.equal(head.status, 200, path); assert.equal(head.bytes.length, 0, path);
          assert.equal(head.headers['content-type'], type, path);
          assert.equal(Number(head.headers['content-length']), expected.length, path);
        }
      }
      const readme = await request('/templates/README-import-templates.txt');
      assert.equal(readme.status, 200); assert.equal(readme.headers['content-type'], 'text/plain; charset=utf-8');
      assert.deepEqual(readme.bytes, readFileSync(resolve(PROJECT_ROOT, 'dist/templates/README-import-templates.txt')));
    });
    await test('Migration/seed reruns preserve user documents and SKU revisions', async () => {
      const before = { state: await getDoc('state', admin), saved: await getDoc('saved', admin), skus: await getDoc('skus', admin) }, catalogs=(await request('/api/catalogs',admin)).json;
      await migrate(pool); await seed(pool); await seed(pool);
      for (const key of ['state', 'saved', 'skus']) assert.deepEqual(await getDoc(key, admin), before[key]);
      assert.deepEqual((await request('/api/catalogs',admin)).json,catalogs);
    });
    await test('Application restart loads committed state/history/SKU and existing sessions', async () => {
      state.a.note = 'QA restart marker 👓';
      const write = await putDoc('state', state, (await getDoc('state',admin)).revision, admin); assert.equal(write.status, 200, write.text);
      await stopApp(); await pool.end(); pool = createPool(config); await startApp();
      assert.equal((await getDoc('state', admin)).value.a.note, 'QA restart marker 👓');
      assert.equal((await getDoc('saved', admin)).value.length, 1);
      assert.equal((await getDoc('skus', other)).value.skus.length, 3);
      assert.equal((await request('/api/catalogs',admin)).json.value.materials.products.length,92);
    });
    await test('Managed indices persist and reject deletion while referenced by products', async () => {
      let current=(await request('/api/catalogs',admin)).json;
      const value=clone(current.value);value.materials.indexOptions=[...new Set([...value.materials.products.map(p=>p.index),'1.70'])].sort();
      let result=await request('/api/catalogs/indices',{...admin,method:'PUT',body:{value:value.materials.indexOptions,revision:current.revision}});assert.equal(result.status,200,result.text);
      assert.deepEqual(result.json.value,{...current.value,materials:{...current.value.materials,indexOptions:value.materials.indexOptions}});
      current=(await request('/api/catalogs',admin)).json;assert(current.value.materials.indexOptions.includes('1.70'));
      const bad=clone(current.value);bad.materials.indexOptions=bad.materials.indexOptions.filter(n=>n!=='1.60');
      result=await request('/api/catalogs/indices',{...admin,method:'PUT',body:{value:bad.materials.indexOptions,revision:current.revision}});assert.equal(result.status,422,result.text);
      value.materials.indexOptions=value.materials.indexOptions.filter(n=>n!=='1.70');
      result=await request('/api/catalogs/indices',{...admin,method:'PUT',body:{value:value.materials.indexOptions,revision:current.revision}});assert.equal(result.status,200,result.text);
      assert(!(await store.getCatalogs()).value.materials.indexOptions.includes('1.70'));
    });
    await test('Administrators manage login accounts and users cannot mutate shared masters', async () => {
      const password=randomBytes(20).toString('hex'),newPassword=randomBytes(20).toString('hex');
      const body={username:'qaoperator',password,role:'user'};
      let result=await request('/api/users',{...admin,method:'POST',body});assert.equal(result.status,201,result.text);assert.equal(result.json.user.role,'user');
      const id=result.json.user.id;
      result=await request('/api/users',{...admin,method:'POST',body});assert.equal(result.status,409);
      let operator=await login('qaoperator',password);assert.equal(operator.user.role,'user');
      assert.equal((await request('/api/bootstrap',operator)).status,200);
      for(const [path,method] of [['/api/users','GET'],['/api/users','POST'],['/api/users/'+id,'PUT'],['/api/catalogs','PUT'],['/api/documents/skus','PUT']])assert.equal((await request(path,{...operator,method,...(method==='GET'?{}:{body:{}})})).status,403,path);
      let doc=await getDoc('state',operator);assert.equal((await putDoc('state',null,doc.revision,operator)).status,200);
      result=await request('/api/users',admin);assert.equal(result.status,200);assert(result.json.users.every(u=>!u.password_hash&&!u.password));
      result=await request('/api/users/'+admin.user.id,{...admin,method:'PUT',body:{username:'qaadmin',role:'user',active:true}});assert.equal(result.status,422);
      result=await request('/api/users/'+id,{...admin,method:'PUT',body:{username:'qaoperator',role:'administrator',active:true,password:''}});assert.equal(result.status,200,result.text);
      assert.equal((await request('/api/bootstrap',operator)).status,401);
      operator=await login('qaoperator',password);assert.equal(operator.user.role,'administrator');assert.equal((await request('/api/users',operator)).status,200);
      result=await request('/api/users/'+id,{...admin,method:'PUT',body:{username:'qaoperator',role:'user',active:true,password:newPassword}});assert.equal(result.status,200,result.text);
      assert.equal((await request('/api/bootstrap',operator)).status,401);
      assert.equal((await request('/api/session',{method:'POST',body:{username:'qaoperator',password}})).status,401);
      operator=await login('qaoperator',newPassword);assert.equal(operator.user.role,'user');
      result=await request('/api/users/'+id,{...admin,method:'PUT',body:{username:'qaoperator',role:'user',active:false}});assert.equal(result.status,200,result.text);
      assert.equal((await request('/api/bootstrap',operator)).status,401);
      assert.equal((await request('/api/session',{method:'POST',body:{username:'qaoperator',password:newPassword}})).status,401);
    });
    await test('Expired and logged-out sessions cannot access or mutate data', async () => {
      await pool.execute('UPDATE leinz_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE user_id = ?', [other.user.id]);
      assert.equal((await request('/api/session', other)).json.authenticated, false);
      assert.equal((await request('/api/bootstrap', other)).status, 401);
      const logout = await request('/api/session', { method: 'DELETE', ...admin }); assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
      assert.equal((await request('/api/bootstrap', admin)).status, 401);
    });
    await test('Failed database calls return sanitized failure without success acknowledgement', async () => {
      await pool.end();
      const res = await request('/api/health'); assert.equal(res.status, 503); assert.equal(res.json.error.code, 'service_unavailable');
      assert(!res.text.includes(config.mysql.password) && !res.text.includes('SELECT') && !res.text.includes(PROJECT_ROOT));
      const write=await request('/api/catalogs',{method:'PUT',body:{value:{},revision:0},...admin});assert.equal(write.status,503);assert.equal(write.json.error.code,'service_unavailable');assert(!write.json.value);
    });
    console.log('Persistent test data retained only in the explicitly named disposable database for --verify-persistence after a database restart.');
  }
  console.log(JSON.stringify({ ok: failures.length === 0, passed: passed.length, failed: failures.length, databaseVersion: info.version, mode: process.argv.includes('--verify-persistence') ? 'database-restart' : 'integration' }));
} finally {
  await stopApp();
  try { await pool.end(); } catch { /* already closed in failure-path test */ }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { SkuManager, SCHEMA, STORAGE_KEY, validateSku, validateCatalog, planImport, escapeHtml } = require('../dist/sku-manager.js');
const materials = JSON.parse(readFileSync(new URL('../dist/assets/materials.json', import.meta.url), 'utf8'));
const context = { materials, indices: ['1.50', '1.56', '1.57', '1.60', '1.67', '1.74'] };
const originalDate = '2026-11-03T08:00:00.000Z';
const importDate = '2026-11-03T12:00:00.000Z';
const copy = value => structuredClone(value);
const blankFor = productId => {
  const blank = materials.blanks.find(b => b.productId === productId);
  assert.ok(blank, `Missing real catalog fixture: ${productId}`);
  return blank.id;
};
const assignment = productId => ({
  id: `assignment-${productId.replace(':', '-')}`,
  supplier: materials.products.find(p => p.id === productId).supplier,
  productId,
  blankIds: [blankFor(productId)]
});
const sku = (code = 'TEST-ALPHA', id = 'sku-alpha') => ({
  id, code, name: 'Fixture SKU — not production inventory', active: true,
  variants: [{
    index: '1.60', enabled: true,
    power: { sphMin: -8, sphMax: 6, cylMin: -4, cylMax: 0, addMin: 0, addMax: 3 },
    assignments: [assignment('DMO:SPHW60'), assignment('SOA:SPHW60')]
  }, {
    index: '1.74', enabled: true,
    power: { sphMin: -12, sphMax: 4, cylMin: -6, cylMax: 0, addMin: 0, addMax: 0 },
    assignments: [assignment('DMO:SPHW74')]
  }],
  createdAt: originalDate, updatedAt: originalDate
});
const envelope = skus => ({ schema: SCHEMA, skus });
const invalidSku = (mutate, pattern) => {
  const input = sku(); mutate(input);
  const result = validateSku(input, context);
  assert.equal(result.ok, false);
  assert.equal(result.sku, null);
  if (pattern) assert.match(result.errors.join(' '), pattern);
};

test('valid multi-index SKU supports multiple real supplier assignments without mutating its input', () => {
  const input = sku(); const snapshot = copy(input);
  const result = validateSku(input, context);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.sku, snapshot);
  assert.deepEqual(input, snapshot);
  result.sku.variants[0].assignments[0].blankIds.push('not-shared');
  assert.deepEqual(input, snapshot);
});

test('normalizes numeric input strings and preserves legitimate zero-only ranges', () => {
  const input = sku();
  input.code = '  TEST-ALPHA  '; input.name = '  Test product  ';
  input.variants[0].power = Object.fromEntries(Object.keys(input.variants[0].power).map(key => [key, '0']));
  const result = validateSku(input, context);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.sku.code, 'TEST-ALPHA');
  assert.equal(result.sku.name, 'Test product');
  assert.deepEqual(Object.values(result.sku.variants[0].power), [0, 0, 0, 0, 0, 0]);
});

test('requires explicit finite finish limits, ordered endpoints, minus CYL, and nonnegative ADD', () => {
  for (const value of ['', ' ', null, undefined, true, NaN, Infinity, 'not-a-number']) {
    invalidSku(s => { s.variants[0].power.sphMin = value; }, /sphMin/);
  }
  invalidSku(s => { s.variants[0].power.sphMin = 8; }, /minimum SPH/);
  invalidSku(s => { s.variants[0].power.cylMax = 0.25; }, /CYL minus/);
  invalidSku(s => { s.variants[0].power.addMin = -0.25; }, /ADD tidak boleh negatif/);
});

test('rejects supplier, index, product, and blank mismatches', () => {
  invalidSku(s => { s.variants[0].assignments[0].supplier = 'SOA'; }, /supplier tidak sesuai/);
  invalidSku(s => { s.variants[0].index = '1.56'; }, /indeks produk bahan baku tidak sesuai/);
  invalidSku(s => { s.variants[0].index = '1.59'; }, /enam indeks simulator/);
  invalidSku(s => { s.variants[0].assignments[0].productId = 'DMO:UNKNOWN'; }, /tidak ditemukan/);
  invalidSku(s => { s.variants[0].assignments[0].blankIds = [blankFor('SOA:SPHW60')]; }, /tidak berasal dari produk/);
  invalidSku(s => { s.variants[0].assignments[0].blankIds = ['DMO:SPHW60:BC1.00:D80.00']; }, /tidak tersedia dalam katalog/);
});

test('requires configured blanks for enabled variants and rejects duplicate mappings', () => {
  invalidSku(s => { s.variants[0].assignments = []; }, /tambahkan supplier/);
  invalidSku(s => { s.variants[0].assignments[0].blankIds = []; }, /setidaknya satu blank/);
  invalidSku(s => { s.variants.push(copy(s.variants[0])); }, /lebih dari satu kali/);
  invalidSku(s => { s.variants[0].assignments.push(copy(s.variants[0].assignments[0])); }, /produk bahan baku yang sama/);
  invalidSku(s => { s.variants[0].assignments[0].blankIds.push(s.variants[0].assignments[0].blankIds[0]); }, /ID blank berulang/);
});

test('rejects empty identity, unsafe IDs, duplicate codes, and active SKU without enabled index', () => {
  invalidSku(s => { s.code = ''; }, /Kode SKU wajib diisi/);
  invalidSku(s => { s.name = ''; }, /Nama produk wajib diisi/);
  invalidSku(s => { s.id = '<script>'; }, /ID SKU tidak valid/);
  invalidSku(s => { s.variants.forEach(v => { v.enabled = false; }); }, /setidaknya satu indeks yang diaktifkan/);
  const result = validateSku(sku('test-alpha', 'sku-other'), { ...context, existing: [sku()] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Kode SKU sudah digunakan/);
});

test('an inactive SKU may retain disabled, unconfigured variants for later completion', () => {
  const input = sku(); input.active = false;
  input.variants = [{ index: '1.60', enabled: false, power: {}, assignments: [] }];
  const result = validateSku(input, context);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(Object.values(result.sku.variants[0].power), [null, null, null, null, null, null]);
});

test('catalog validation is all-or-nothing and rejects schema, duplicate codes, or duplicate IDs', () => {
  assert.equal(validateCatalog({ schema: 'unknown', skus: [] }, context).ok, false);
  assert.equal(validateCatalog(envelope([]), context).ok, true);
  for (const second of [sku('test-alpha', 'sku-second'), sku('TEST-BETA', 'sku-alpha')]) {
    const result = validateCatalog(envelope([sku(), second]), context);
    assert.equal(result.ok, false);
    assert.deepEqual(result.skus, []);
  }
  const bad = sku('TEST-BETA', 'sku-beta'); bad.variants[0].assignments[0].supplier = 'UNKNOWN';
  assert.deepEqual(validateCatalog(envelope([sku(), bad]), context).skus, []);
});

test('import merge preserves existing identity by case-insensitive code and retains unmentioned SKUs', () => {
  const existing = [sku(), sku('TEST-KEEP', 'sku-keep')]; const snapshot = copy(existing);
  const incoming = sku('test-alpha', 'sku-imported-alpha');
  incoming.name = 'Changed fixture'; incoming.active = false; incoming.createdAt = importDate;
  const created = sku('TEST-NEW', 'sku-new');
  const result = planImport(existing, envelope([incoming, created]), { ...context, now: importDate });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.skus.length, 3);
  const updated = result.skus.find(s => s.code === 'test-alpha');
  assert.equal(updated.id, 'sku-alpha');
  assert.equal(updated.createdAt, originalDate);
  assert.equal(updated.updatedAt, importDate);
  assert.equal(updated.name, 'Changed fixture');
  assert.equal(updated.active, false);
  assert.deepEqual(result.skus.find(s => s.id === 'sku-keep'), snapshot[1]);
  assert.deepEqual(result.changes.map(c => c.action), ['update', 'create']);
  assert.deepEqual(existing, snapshot);
});

test('import can rename a SKU by stable ID while preserving its creation date', () => {
  const incoming = sku('RENAMED', 'sku-alpha'); incoming.createdAt = importDate;
  const result = planImport([sku()], envelope([incoming]), { ...context, now: importDate });
  assert.equal(result.ok, true);
  assert.equal(result.skus.length, 1);
  assert.equal(result.skus[0].code, 'RENAMED');
  assert.equal(result.skus[0].createdAt, originalDate);
});

test('import refuses ambiguous identity and multiple rows targeting the same existing SKU', () => {
  const existing = [sku(), sku('TEST-BETA', 'sku-beta')]; const snapshot = copy(existing);
  const collision = planImport(existing, envelope([sku('TEST-ALPHA', 'sku-beta')]), context);
  assert.equal(collision.ok, false);
  assert.match(collision.errors.join(' '), /Kode dan ID mengarah ke SKU berbeda/);
  const duplicateTarget = planImport(existing, envelope([
    sku('TEST-ALPHA', 'sku-alias'),
    sku('RENAMED-ALPHA', 'sku-alpha')
  ]), context);
  assert.equal(duplicateTarget.ok, false);
  assert.match(duplicateTarget.errors.join(' '), /mengarah ke SKU yang sama/);
  assert.deepEqual(existing, snapshot);
  assert.deepEqual(collision.skus, []);
  assert.deepEqual(duplicateTarget.changes, []);
});

test('invalid import cannot partly merge or mutate an existing catalog', () => {
  const existing = [sku()]; const snapshot = copy(existing);
  const bad = sku('BAD-IMPORT', 'sku-bad'); bad.variants[0].power.sphMin = '';
  const result = planImport(existing, envelope([sku('GOOD-IMPORT', 'sku-good'), bad]), context);
  assert.equal(result.ok, false);
  assert.deepEqual(result.skus, []);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(existing, snapshot);
});

test('names and codes can be rendered safely without evaluating HTML', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'alert(1)\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
});

// Persistence tests exercise acknowledgement, conflicts and failure recovery
// without a browser. These adapters model the same cached getItem/async setItem
// contract used by MySQL mode; the manager must never announce an optimistic save.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function persistenceFixture(initial = [], write) {
  let stored = JSON.stringify(envelope(initial)), writes = 0, listRenders = 0, closed = 0;
  const manager = Object.create(SkuManager.prototype);
  Object.assign(manager, {
    materials, context, indices: context.indices, storageMode: 'mysql', saving: false,
    skus: copy(initial), storageSnapshot: stored, storageError: '', storageInvalid: false,
    draft: null, draftBase: null, notices: [], errors: [], changes: [], busyStates: [],
    _renderList() { listRenders++; },
    _editorErrors(errors) { this.errors.push(...errors); },
    _notice(message) { this.notices.push(message); },
    _setSaving(value) { this.saving = value; this.busyStates.push(value); },
    onChange(skus) { this.changes.push(copy(skus)); },
    _closeEditor() { this.draft = null; closed++; }
  });
  const setStored = text => { stored = text; };
  manager.storage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); return stored; },
    setItem(key, text) {
      assert.equal(key, STORAGE_KEY); writes++;
      if (write) return write(text, setStored);
      stored = text;
    }
  };
  return { manager, setStored, getStored: () => stored, writes: () => writes,
    listRenders: () => listRenders, closed: () => closed };
}

test('async save waits for acknowledgement, prevents duplicate writes and keeps the canonical server snapshot', async () => {
  const pending = deferred(); let requested;
  const fixture = persistenceFixture([sku()], text => { requested = text; return pending.promise; });
  const { manager } = fixture;
  const before = copy(manager.skus), beforeSnapshot = manager.storageSnapshot;
  const revised = sku(); revised.name = 'Acknowledged server update';
  const operation = manager._commit([revised]);
  assert.equal(manager.saving, true);
  assert.equal(fixture.writes(), 1);
  assert.deepEqual(manager.skus, before);
  assert.equal(manager.storageSnapshot, beforeSnapshot);
  assert.equal(manager.changes.length, 0);
  assert.equal(await manager._commit([revised]), false, 'A second click must not submit a second write.');
  assert.equal(fixture.writes(), 1);
  // MySQL JSON responses may reorder keys; the returned cache, not the request
  // string, is the base for the next optimistic-concurrency comparison.
  const payload = JSON.parse(requested);
  const canonical = JSON.stringify({ skus: payload.skus, schema: payload.schema, updatedAt: payload.updatedAt });
  fixture.setStored(canonical); pending.resolve();
  assert.equal(await operation, true);
  assert.equal(manager.saving, false);
  assert.equal(manager.storageSnapshot, canonical);
  assert.deepEqual(manager.skus, [revised]);
  assert.equal(manager.changes.length, 1);
  assert.deepEqual(manager.busyStates, [true, false]);
});

test('network failure preserves the previous master and the unsaved draft', async () => {
  const fixture = persistenceFixture([sku()], async () => { throw Error('Connection interrupted'); });
  const { manager } = fixture;
  manager.draft = sku(); manager.draft.name = 'Unsaved work stays visible';
  const draft = copy(manager.draft), previous = copy(manager.skus);
  assert.equal(await manager._commit([manager.draft]), false);
  assert.deepEqual(manager.skus, previous);
  assert.deepEqual(manager.draft, draft);
  assert.equal(manager.saving, false);
  assert.match(manager.errors.join(' '), /Connection interrupted/);
  assert.equal(fixture.closed(), 0);
});

test('409 conflict refreshes the authoritative master while retaining the draft and actionable error', async () => {
  const remote = sku(); remote.name = 'Changed on another device'; remote.updatedAt = importDate;
  const fixture = persistenceFixture([sku()], async (text, setStored) => {
    setStored(JSON.stringify(envelope([remote])));
    throw Object.assign(Error('Version conflict'), { status: 409 });
  });
  const { manager } = fixture;
  manager.draft = sku(); manager.draft.name = 'My unsaved draft';
  const draft = copy(manager.draft);
  assert.equal(await manager._commit([manager.draft]), false);
  assert.deepEqual(manager.skus, [remote]);
  assert.deepEqual(manager.draft, draft);
  assert.equal(manager.storageSnapshot, fixture.getStored());
  assert.match(manager.errors.join(' '), /Data terbaru sudah dimuat/);
  assert.match(manager.errors.join(' '), /draft Anda dipertahankan/);
  assert.equal(manager.saving, false);
});

test('stale cached master is detected before submission and does not overwrite a concurrent update', async () => {
  const fixture = persistenceFixture([sku()]);
  const remote = sku(); remote.name = 'Newer cached revision';
  fixture.setStored(JSON.stringify(envelope([remote])));
  assert.equal(await fixture.manager._commit([sku('NEW', 'sku-new')]), false);
  assert.equal(fixture.writes(), 0);
  assert.deepEqual(fixture.manager.skus, [remote]);
  assert.match(fixture.manager.errors.join(' '), /berubah di tab atau perangkat lain/);
});

test('the 1001st individual SKU is rejected before storage so reload cannot invalidate the entire master', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: 'sku-limit-' + i, code: 'LIMIT-' + i, name: 'Limit fixture ' + i, active: false,
    variants: [{ index: '1.60', enabled: false, power: {}, assignments: [] }],
    createdAt: originalDate, updatedAt: originalDate
  }));
  assert.equal(validateCatalog(envelope(rows), context).ok, true);
  const fixture = persistenceFixture(rows);
  assert.equal(await fixture.manager._commit([...rows, sku('OVER-LIMIT', 'sku-over-limit')]), false);
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.manager.skus.length, 1000);
  assert.match(fixture.manager.errors.join(' '), /1\.000 SKU/);
});

test('complete catalog validation prevents duplicate IDs even if each SKU is individually valid', async () => {
  const fixture = persistenceFixture([sku()]);
  const other = sku('DIFFERENT-CODE', 'sku-alpha');
  assert.equal(validateSku(other, context).ok, true);
  assert.equal(await fixture.manager._commit([sku(), other]), false);
  assert.equal(fixture.writes(), 0);
  assert.match(fixture.manager.errors.join(' '), /ID SKU berulang/);
});

test('the editor closes and shows success only after an async save is acknowledged', async () => {
  const pending = deferred(); let requested;
  const fixture = persistenceFixture([], text => { requested = text; return pending.promise; });
  const { manager } = fixture;
  manager.draft = sku(); manager.draftBase = null;
  const saving = manager._saveDraft();
  assert.ok(manager.draft);
  assert.equal(fixture.closed(), 0);
  assert.equal(manager.notices.some(message => message.includes('tersimpan')), false);
  fixture.setStored(requested); pending.resolve();
  await saving;
  assert.equal(fixture.closed(), 1);
  assert.equal(manager.draft, null);
  assert.ok(manager.notices.some(message => /SKU TEST-ALPHA tersimpan/.test(message)));
});

test('failed editor save does not close the editor or announce success', async () => {
  const fixture = persistenceFixture([sku()], async () => { throw Error('Database unavailable'); });
  const { manager } = fixture;
  manager.draft = sku(); manager.draft.name = 'Attempted update'; manager.draftBase = originalDate;
  await manager._saveDraft();
  assert.equal(manager.draft.name, 'Attempted update');
  assert.equal(fixture.closed(), 0);
  assert.equal(manager.notices.some(message => /SKU TEST-ALPHA tersimpan/.test(message)), false);
});

test('SKU activation status does not change until the asynchronous toggle succeeds', async () => {
  const pending = deferred(); let requested;
  const fixture = persistenceFixture([sku()], text => { requested = text; return pending.promise; });
  const toggling = fixture.manager._toggle('sku-alpha');
  assert.equal(fixture.manager.getSku('sku-alpha').active, true);
  fixture.setStored(requested); pending.resolve();
  await toggling;
  assert.equal(fixture.manager.getSku('sku-alpha').active, false);
});

test('save busy state disables editable controls and restores their original disabled status', () => {
  const controls = [{ disabled: false }, { disabled: true }, { disabled: false }];
  const attributes = new Map();
  const manager = Object.create(SkuManager.prototype);
  manager.container = {
    setAttribute(key, value) { attributes.set(key, value); },
    querySelectorAll() { return controls; },
    contains(element) { return controls.includes(element); }
  };
  manager._setSaving(true);
  assert.deepEqual(controls.map(el => el.disabled), [true, true, true]);
  assert.equal(attributes.get('aria-busy'), 'true');
  manager._setSaving(false);
  assert.deepEqual(controls.map(el => el.disabled), [false, true, false]);
  assert.equal(attributes.get('aria-busy'), 'false');
});

test('public storage reload reconciles a successful retry without discarding the visible draft', () => {
  const fixture = persistenceFixture([sku()]);
  const { manager } = fixture;
  manager.draft = sku(); manager.draft.name = 'Recoverable draft'; manager.draftBase = originalDate;
  const draft = copy(manager.draft);
  const acknowledged = sku(); acknowledged.name = 'Saved by retry'; acknowledged.updatedAt = importDate;
  fixture.setStored(JSON.stringify(envelope([acknowledged])));
  assert.equal(manager.reloadFromStorage(), true);
  assert.deepEqual(manager.skus, [acknowledged]);
  assert.deepEqual(manager.draft, draft);
  assert.equal(manager.storageSnapshot, fixture.getStored());
  assert.equal(fixture.closed(), 0);
  assert.match(manager.errors.join(' '), /Draft Anda tetap tersedia/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Import = require('../dist/tabular-import.js');
const Sku = require('../dist/sku-manager.js');
const Engine = require('../dist/blank-engine.js');
const load = name => JSON.parse(readFileSync(new URL(`../dist/assets/${name}.json`, import.meta.url), 'utf8'));
const base = { materials: load('materials'), shapes: load('shapes'), tints: load('tints') };
const clone = value => structuredClone(value);
const template = name => readFileSync(new URL(`../dist/templates/${name}-template.csv`, import.meta.url), 'utf8');
const targetBlank = 'DMO:SPHG60:BC1.00:D75.00';
const time = '2026-11-04T00:00:00.000Z';
const csv = (headers, rows) => [headers, ...rows].map(row => row.map(value => {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}).join(',')).join('\r\n');

test('tabular SKU creation does not overwrite an imported SKU whose code was subsequently renamed', () => {
  const parsed = Import.parseCSV(template('sku'), { filename: 'sku-template.csv' });
  const first = Import.buildSkuImport([], base.materials, parsed, { now: time }).payload.skus[0];
  const renamed = { ...first, code: 'RENAMED-EXISTING', name: 'Previously imported and renamed product' };
  const result = Import.buildSkuImport([renamed], base.materials, parsed, { now: time });
  const plan = Sku.planImport([renamed], result.payload, { materials: base.materials, now: time });
  assert.equal(plan.ok, true, plan.errors?.join('\n'));
  assert.deepEqual(plan.skus.map(item => item.code).sort(), ['DEMO-IMPORT', 'RENAMED-EXISTING']);
  assert.deepEqual(plan.skus.find(item => item.code === 'RENAMED-EXISTING'), renamed);
  assert.notEqual(plan.skus.find(item => item.code === 'DEMO-IMPORT').id, renamed.id);
  assert.equal(plan.changes[0].action, 'create');
});

test('description inference never rounds an unsupported refractive index to a supported index', () => {
  for (const index of ['1.599', '1.574', '1.6001']) {
    const input = csv(Import.HEADERS.materials, [[
      'TEST-SUPPLIER', 'TEST-UNSUPPORTED', `Spheric ${index}`, 1, 75, 7.5, 15,
      -9.25, -7.75, -6, 0, 0, 0,
    ]]);
    assert.throws(() => Import.buildMasterImport(base, Import.parseCSV(input), { kind: 'materials', now: time }),
      /indeks|index|Descr/i, `Index ${index} must require correction`);
    const knownProduct = csv(Import.HEADERS.materials, [[
      'DMO', 'SPHG60', `Spheric ${index}`, 1, 75, 7.5, 15,
      -9.25, -7.75, -6, 0, 0, 0,
    ]]);
    assert.throws(() => Import.buildMasterImport(base, Import.parseCSV(knownProduct), { kind: 'materials', now: time }),
      /indeks|index|Descr/i, `Existing product must not hide conflicting Descr index ${index}`);
    const explicitIndex = csv([...Import.HEADERS.materials, 'index'], [[
      'TEST-SUPPLIER', 'TEST-EXPLICIT', `Spheric ${index}`, 1, 75, 7.5, 15,
      -9.25, -7.75, -6, 0, 0, 0, 1.6,
    ]]);
    assert.throws(() => Import.buildMasterImport(base, Import.parseCSV(explicitIndex), { kind: 'materials', now: time }),
      /indeks|index|Descr/i, `Explicit index must not hide conflicting Descr index ${index}`);
  }
  // An ordinary source spelling of 1.6 remains equivalent to the supported 1.60.
  const valid = csv(Import.HEADERS.materials, [[
    'TEST-SUPPLIER', 'TEST-VALID', 'Spheric 1.6', 1, 75, 7.5, 15, -9.25, -7.75, -6, 0, 0, 0,
  ]]);
  const result = Import.buildMasterImport(base, Import.parseCSV(valid), { kind: 'materials', now: time });
  assert.equal(result.payload.catalogs.materials.products.find(p => p.code === 'TEST-VALID').index, '1.60');
});

test('material import preserves archived identities, finishing profiles, and unrelated catalogs', () => {
  const input = clone(base);
  const product = input.materials.products.find(p => p.id === 'DMO:SPHG60');
  const blank = input.materials.blanks.find(b => b.id === targetBlank);
  product.active = false;
  product.opticalProfile = { minCenterMm: 1.3, minEdgeMm: 1.5, source: 'lab', reference: 'Regression fixture profile' };
  blank.active = false;
  blank.opticalProfile = { minCenterMm: 1.4, minEdgeMm: 1.6, source: 'lab', reference: 'Regression fixture blank profile' };
  input.materials.rules.find(r => r.blankId === targetBlank).active = false;
  const before = clone(input);
  const text = template('blank').replaceAll('Spherical 1.6 UV420  Grey Spin', 'Spherical 1.6 UV420 Grey Spin revised label');
  const result = Import.buildMasterImport(input, Import.parseCSV(text), { kind: 'materials', now: time }).payload.catalogs;
  const updatedProduct = result.materials.products.find(p => p.id === product.id);
  assert.equal(updatedProduct.id, product.id);
  assert.equal(updatedProduct.active, false);
  assert.deepEqual(updatedProduct.opticalProfile, product.opticalProfile);
  assert.deepEqual(result.materials.blanks, before.materials.blanks);
  assert.deepEqual(result.materials.rules, before.materials.rules);
  assert.deepEqual(result.shapes, before.shapes);
  assert.deepEqual(result.tints, before.tints);
  assert.deepEqual(input, before, 'Preparing an import must not mutate the live catalog');
});

test('authoritative replacement affects only the represented blank and retains sheet/row provenance for new duplicates', () => {
  const values = ['DMO', 'SPHG60', 'Spherical 1.6 UV420  Grey Spin', 1, 75, 7.5, 15, -8.75, -8.25, -3, -1, 0, 0];
  const parsed = Import.parseCSV(csv(Import.HEADERS.materials, [values]), { filename: 'coverage.xlsx' });
  parsed.format = 'Excel';
  parsed.sheets[0].name = 'SupplierData';
  parsed.sheets[0].records[1].row = 12;
  const otherSheet = clone(parsed.sheets[0]);
  otherSheet.name = 'Continuation';
  otherSheet.records[1].row = 7;
  parsed.sheets.push(otherSheet);
  const prepared = Import.buildMasterImport(base, parsed, { kind: 'materials', now: time });
  const result = prepared.payload.catalogs;
  assert.equal(prepared.info.duplicateRows, 1);
  assert.equal(prepared.info.removedRules, 2);
  assert.equal(prepared.info.addedRules, 1);
  const rules = result.materials.rules.filter(r => r.blankId === targetBlank);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].sourceLocations, [{ sheet: 'SupplierData', row: 12 }, { sheet: 'Continuation', row: 7 }]);
  assert.deepEqual(rules[0].sourceRows, [12, 7]);
  assert.equal(rules[0].sourceFile, 'coverage.xlsx');
  assert.equal(rules[0].exactDuplicateCount, 1);
  assert.deepEqual(result.materials.rules.filter(r => r.blankId !== targetBlank), base.materials.rules.filter(r => r.blankId !== targetBlank));
  assert.deepEqual(result.materials.products, base.materials.products);
  assert.deepEqual(result.materials.blanks, base.materials.blanks);
});

test('imported real coupled SPH/CYL/ADD rules retain holes when evaluated by the simulator engine', () => {
  const result = Import.buildMasterImport(base, Import.parseCSV(template('blank')), { kind: 'materials', now: time });
  const frame = Engine.estimateFrame({
    points: base.shapes.items[0].points, width: 50, height: 38, dbl: 18,
    pdR: 34, pdL: 34, heightR: 19, heightL: 19, allowanceDiameter: 2,
  });
  assert.equal(frame.valid, true);
  for (const [rx, expected] of [
    [{ sph: -9, cyl: -4, add: 0 }, true],
    [{ sph: -9, cyl: 0, add: 1 }, true],
    [{ sph: -9, cyl: -4, add: 1 }, false],
    [{ sph: -10, cyl: 0, add: 0.25 }, true],
    [{ sph: -7.75, cyl: -6, add: 0 }, true],
    [{ sph: -7.75, cyl: 0, add: 0.25 }, false],
  ]) {
    const evaluation = Engine.evaluate({ materials: result.payload.catalogs.materials, index: '1.60', productId: 'DMO:SPHG60', rx, frame });
    assert.equal(evaluation.valid, true);
    const row = evaluation.rows.find(r => r.blank.id === targetBlank);
    assert.equal(row.rawPowerMatches, expected, JSON.stringify(rx));
    assert.equal(row.eligibleBoth, expected, JSON.stringify(rx));
  }
});

test('an invalid later data row aborts the complete import without applying earlier additions', () => {
  const original = clone(base);
  const valid = ['NEW-SUPPLIER', 'VALID-FIRST', 'Spheric 1.60', 2, 75, 8, 15, -4, 0, -2, 0, 0, 0];
  const invalid = ['NEW-SUPPLIER', 'INVALID-SECOND', 'Spheric 1.60', 2, 75, '', 15, -4, 0, -2, 0, 0, 0];
  assert.throws(() => Import.buildMasterImport(base, Import.parseCSV(csv(Import.HEADERS.materials, [valid, invalid])), { kind: 'materials', now: time }), /center_thickness/);
  assert.deepEqual(base, original);
});

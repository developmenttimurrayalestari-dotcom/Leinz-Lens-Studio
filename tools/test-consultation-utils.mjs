import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { validSavedEntry, historyTintLabels, consultationToState } = require('../dist/consultation-utils.js');
const catalogs = Object.fromEntries(['tints', 'materials', 'shapes'].map(name => [name,
  JSON.parse(readFileSync(new URL(`../dist/assets/${name}.json`, import.meta.url), 'utf8'))
]));
const copy = value => structuredClone(value);

function consultation() {
  const choice = (label, productId, tintCode, camera) => {
    const product = catalogs.materials.products.find(item => item.id === productId);
    assert.ok(product, 'Real fixture product must exist.');
    const blank = catalogs.materials.blanks.find(item => item.productId === productId);
    return {
      choice: label, index: product.index,
      product: { supplier: product.supplier, lensCode: product.code, name: product.name, index: product.index },
      tint: { code: tintCode, previewColorSource: 'PDF-screen-sample', previewColor: '#b2bfce' },
      sku: null, blankSelection: { eyes: { R: { id: blank.id }, L: { id: blank.id } } },
      camera, note: 'Preserved consultation note'
    };
  };
  return {
    schema: 'trl-lens-consultation/1.3', applicationVersion: '2.0.0', title: 'QA consultation',
    createdAt: '2026-11-03T07:00:00.000Z',
    preview: { comparisonUnit: 'lens-pair', cameraSynchronized: false,
      frameDisplay: { visible: true, style: 'half-rimless', templesVisible: false, templesEnabled: false } },
    frame: { shapeCode: 'cat-eye', a: 54, b: 41.8, dbl: 19, allowanceDiameter: 2.5,
      shapeReference: { geometryRevision: 'svg-reference-v1' } },
    prescription: { sph: -5.25, cyl: -1.5, axis: 125, add: 1.25,
      monocularPd: { R: 31, L: 33 }, fittingHeight: { R: 19, L: 21 } },
    choices: [choice('A', 'DMO:SPHW74', '09S', { yaw: -.6, pitch: .2, zoom: 1.1 }),
      choice('B', 'SOA:SPHW50', '09G', { yaw: .4, pitch: -.1, zoom: .9 })]
  };
}

test('history validation rejects malformed entries while accepting recoverable legacy records', () => {
  for (const value of [null, [], '', 1, {}, { id: 'okay', state: null }, { id: '<script>', state: {} }, { id: 'okay', state: [] }]) {
    assert.equal(validSavedEntry(value), false);
  }
  assert.equal(validSavedEntry({ id: 'saved-1', state: {} }), true);
  assert.equal(validSavedEntry({ id: 'saved-1', state: {}, data: { choices: 'corrupt legacy field' } }), true);
});

test('malformed history choice lists fall back to the saved state without throwing', () => {
  for (const choices of [null, undefined, false, 'broken', { A: '09S' }]) {
    assert.equal(historyTintLabels({ data: { choices }, state: { a: { tintCode: '09S' }, b: { tintCode: '09G' } } }), '09S / 09G');
  }
  assert.equal(historyTintLabels(null), 'Bening / Bening');
  assert.equal(historyTintLabels({ data: { choices: [null, { tint: { code: 7 } }] } }), 'Bening / Bening');
  assert.equal(historyTintLabels({ data: { choices: [{ tint: { code: 'CONG' } }, { tint: null }, { tint: { code: 'ignored-third' } }] } }), 'CONG / Bening');
});

test('schema 1.3 import preserves frame geometry, six-index identities, R/L centration and display settings', () => {
  const input = consultation(), before = copy(input), state = consultationToState(input, catalogs);
  assert.deepEqual(input, before, 'Import validation must not mutate the original evidence.');
  assert.deepEqual({ shape: state.shape, revision: state.shapeRevision, a: state.width, b: state.height, dbl: state.dbl, allowance: state.allowanceDiameter },
    { shape: 'cat-eye', revision: 'svg-reference-v1', a: 54, b: 41.8, dbl: 19, allowance: 2.5 });
  assert.deepEqual([state.sph, state.cyl, state.axis, state.add], [-5.25, -1.5, 125, 1.25]);
  assert.deepEqual([state.pdR, state.pdL, state.heightR, state.heightL], [31, 33, 19, 21]);
  assert.equal(state.a.index, '1.74'); assert.equal(state.b.index, '1.50');
  assert.equal(state.a.productId, 'DMO:SPHW74'); assert.equal(state.b.productId, 'SOA:SPHW50');
  assert.equal(state.showFrame, true); assert.equal(state.showTemples, false);
  assert.equal(state.frameStyle, 'half-rimless'); assert.equal(state.sync, false);
  assert.equal(state.a.tintCode, '09S'); assert.equal(state.b.tintCode, '09G');
  assert.deepEqual(state.a.camera, input.choices[0].camera); assert.deepEqual(state.b.camera, input.choices[1].camera);
  assert.equal(state.a.blankIdR, input.choices[0].blankSelection.eyes.R.id);
  assert.equal(state.b.blankIdL, input.choices[1].blankSelection.eyes.L.id);
});

test('A and B are identified by their labels even if the JSON choices are in reverse order', () => {
  const input = consultation(); input.choices.reverse();
  const state = consultationToState(input, catalogs);
  assert.equal(state.a.index, '1.74'); assert.equal(state.b.index, '1.50');
  assert.equal(state.a.productId, 'DMO:SPHW74'); assert.equal(state.b.productId, 'SOA:SPHW50');
});

test('pre-frame schema 1.3 exports get explicit Full Rim defaults and hidden frames retain the temple preference', () => {
  const input = consultation(); delete input.preview.frameDisplay; delete input.frame.allowanceDiameter;
  let state = consultationToState(input, catalogs);
  assert.equal(state.showFrame, true); assert.equal(state.showTemples, true); assert.equal(state.frameStyle, 'full-rim');
  assert.equal(state.allowanceDiameter, 2);
  input.preview.frameDisplay = { visible: false, style: 'rimless', templesVisible: false, templesEnabled: true };
  state = consultationToState(input, catalogs);
  assert.equal(state.showFrame, false); assert.equal(state.showTemples, true); assert.equal(state.frameStyle, 'rimless');
  delete input.preview.frameDisplay.templesEnabled;
  assert.equal(consultationToState(input, catalogs).showTemples, false);
});

test('custom tint color, notes and an unresolved SKU identity survive import for later eligibility checks', () => {
  const input = consultation();
  input.choices[0].tint = { code: 'CONG', previewColorSource: 'user-selected-consultation-color', previewColor: '#1a2b3c' };
  input.choices[0].sku = { id: 'sku-not-installed-here' };
  input.choices[0].note = 'x'.repeat(900);
  const state = consultationToState(input, catalogs);
  assert.equal(state.a.tintCode, 'CONG'); assert.equal(state.a.customColor, '#1a2b3c');
  assert.equal(state.a.skuId, 'sku-not-installed-here'); assert.equal(state.a.note.length, 800);
  assert.equal(state.b.customColor, '#9b7965', 'A PDF preview swatch must not be treated as a custom tint.');
});

test('missing material without a SKU blocks import rather than silently replacing the supplier or product', () => {
  const input = consultation(); input.choices[0].product.lensCode = 'NO-LONGER-AVAILABLE';
  assert.throws(() => consultationToState(input, catalogs), /Produk bahan baku.*tidak ditemukan/);
  input.choices[0].sku = { id: 'sku-keep-blocked' };
  const state = consultationToState(input, catalogs);
  assert.equal(state.a.productId, '');
  assert.equal(state.a.skuId, 'sku-keep-blocked', 'The unavailable SKU must not become unrestricted catalog mode.');
});

test('wrong schema, incomplete pairs and unavailable indices cannot be imported', () => {
  for (const mutate of [
    item => { item.schema = 'trl-lens-consultation/1.2'; },
    item => { item.choices.pop(); },
    item => { item.choices[1].choice = 'A'; },
    item => { item.choices[0].index = '1.59'; },
    item => { item.choices[0].index = 1.74; },
    item => { item.frame.shapeCode = 'browline'; }
  ]) {
    const input = consultation(); mutate(input);
    assert.throws(() => consultationToState(input, catalogs));
  }
});

test('invalid powers and dimension values are rejected instead of being silently clamped', () => {
  for (const [field, value] of [['sph', -21], ['sph', '0'], ['sph', null], ['sph', Infinity], ['cyl', .25], ['add', -1], ['axis', 181]]) {
    const input = consultation(); input.prescription[field] = value;
    assert.throws(() => consultationToState(input, catalogs), new RegExp('Nilai ' + field));
  }
  for (const [field, value] of [['a', 34], ['b', 61], ['dbl', 29], ['allowanceDiameter', -1]]) {
    const input = consultation(); input.frame[field] = value;
    assert.throws(() => consultationToState(input, catalogs), /Nilai/);
  }
  const missingPd = consultation(); delete missingPd.prescription.monocularPd.R;
  assert.throws(() => consultationToState(missingPd, catalogs), /pdR/);
});

test('explicit frame visibility and camera sync flags must be booleans', () => {
  for (const key of ['visible', 'templesVisible', 'templesEnabled']) {
    const input = consultation(); input.preview.frameDisplay[key] = 'false';
    assert.throws(() => consultationToState(input, catalogs), /boolean/);
  }
  const input = consultation(); input.preview.cameraSynchronized = 'false';
  assert.throws(() => consultationToState(input, catalogs), /boolean/);
  input.preview.cameraSynchronized = true; input.preview.frameDisplay.style = 'unsupported';
  assert.throws(() => consultationToState(input, catalogs), /frame/);
});

test('invalid nested types and unsafe SKU or blank identifiers cannot erase availability restrictions', () => {
  for (const field of ['tint', 'product', 'sku', 'blankSelection']) {
    const input = consultation(); input.choices[0][field] = 'invalid-object';
    assert.throws(() => consultationToState(input, catalogs), new RegExp(field));
  }
  for (const value of ['', '<script>', {}, [], 7]) {
    const input = consultation(); input.choices[0].sku = { id: value };
    assert.throws(() => consultationToState(input, catalogs), /ID SKU atau blank/);
  }
  const input = consultation(); input.choices[0].blankSelection.eyes.R.id = '../another-record';
  assert.throws(() => consultationToState(input, catalogs), /ID SKU atau blank/);
});

test('invalid camera and unavailable tint codes are rejected without altering the source document', () => {
  for (const value of ['bad-camera', { yaw: 0, pitch: 0, zoom: 0 }, { yaw: 0, pitch: 0, zoom: 3 }, { yaw: NaN, pitch: 0, zoom: 1 }]) {
    const input = consultation(); input.choices[0].camera = value;
    assert.throws(() => consultationToState(input, catalogs), /Kamera/);
  }
  const input = consultation(); input.choices[0].tint.code = 'NO-SUCH-TINT'; const before = copy(input);
  assert.throws(() => consultationToState(input, catalogs), /Kode tint/);
  assert.deepEqual(input, before);
});

test('optical finishing parameters round-trip independently from blank CT and ET', () => {
  const input=consultation();
  input.preview.optics={useOverride:true,profile:{minCenterMm:1.2,minEdgeMm:1.4,frontPowerD:4,
    frontCurveBasis:'reference-index',curveReferenceIndex:1.53,frontRadiusMm:132.5,
    frontConic:0,backConic:0,source:'lab',reference:'QA supplied parameters; no production validation claim'}};
  const before=copy(input),state=consultationToState(input,catalogs);
  assert.deepEqual(state.optics,input.preview.optics);
  assert.deepEqual(input,before);
  state.optics.profile.minCenterMm=1.7;
  assert.equal(input.preview.optics.profile.minCenterMm,1.2,'Imported state must not alias the evidence.');
  assert.equal(consultationToState(consultation(),catalogs).optics.useOverride,false,'Legacy consultation keeps current master defaults.');
});

test('invalid optical overrides reject the whole consultation instead of inventing thinner results', () => {
  for(const optics of [null,[],{useOverride:'false',profile:{}},{useOverride:true},
    {useOverride:true,profile:{minCenterMm:.1}},
    {useOverride:true,profile:{minEdgeMm:NaN}},
    {useOverride:false,profile:{frontRadiusMm:5}},
    {useOverride:true,profile:{frontCurveBasis:'unknown'}},
    {useOverride:true,profile:{backConic:-1}},
    {useOverride:true,profile:{source:'lab',reference:''}}]){
    const input=consultation();input.preview.optics=optics;
    assert.throws(()=>consultationToState(input,catalogs),/CT\/ET/);
  }
});

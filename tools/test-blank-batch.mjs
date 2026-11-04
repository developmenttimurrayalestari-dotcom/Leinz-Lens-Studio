import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const batch = require('../dist/blank-batch.js');
const engine = require('../dist/blank-engine.js');
const materials = JSON.parse(readFileSync(new URL('../dist/assets/materials.json', import.meta.url), 'utf8'));
const frame = engine.estimateFrame({ points: [[-.5,0],[0,-.5],[.5,0],[0,.5]], width: 40, height: 30, dbl: 18, pdR: 29, pdL: 29, heightR: 15, heightL: 15, allowanceDiameter: 2 });
const choices = [
  { key: 'a', index: '1.60', productId: 'DMO:SPHG60' },
  { key: 'b', index: '1.50', productId: 'SOA:F35W50' }
];
const options = { materials, frame, choices };
test('batch retains row-wise joint power coverage from the reference workbook', () => {
  const prescriptions = [{ sph: -9, cyl: -4, add: 0 }, { sph: -9, cyl: 0, add: 1 }, { sph: -9, cyl: -4, add: 1 }];
  const before = JSON.stringify({ prescriptions, options });
  const results = batch.evaluate(prescriptions, options);
  const candidate = result => result.choices[0].candidates.find(x => x.blankId === 'DMO:SPHG60:BC1.00:D75.00');
  assert(candidate(results[0])); assert(candidate(results[1])); assert.equal(candidate(results[2]), undefined);
  assert(candidate(results[0]).matchingRuleIds.includes('rule:b3419e086005424b'));
  assert(candidate(results[1]).matchingRuleIds.includes('rule:7722a32c86d60a10'));
  assert.equal(JSON.stringify({ prescriptions, options }), before, 'batch cannot mutate the active consultation or master');
});
test('batch preserves SPH/CYL coverage holes independently of ADD', () => {
  const results = batch.evaluate([{ sph: -5, cyl: -5, add: 0 }, { sph: -5.25, cyl: -4.75, add: 0 }, { sph: -5.25, cyl: -5, add: 0 }], options);
  const has = row => row.choices[1].candidates.some(x => x.blankId === 'SOA:F35W50:BC1.00:D70.00');
  assert(has(results[0])); assert(has(results[1])); assert.equal(has(results[2]), false);
});
test('each row intersects supplier rules with SKU power, assignments and per-eye diameter', () => {
  const skuVariant = { index: '1.60', enabled: true, power: { sphMin: -9, sphMax: -8, cylMin: -4, cylMax: 0, addMin: 0, addMax: 0 }, assignments: [{ supplier: 'DMO', productId: 'DMO:SPHG60', blankIds: ['DMO:SPHG60:BC1.00:D75.00'] }] };
  const asymmetricFrame = { ...frame, eyes: { R: { requiredDiameter: 76 }, L: { requiredDiameter: 50 } } };
  const out = batch.evaluate([{ sph: -9, cyl: -4, add: 0 }, { sph: -9.25, cyl: -4, add: 0 }], { ...options, frame: asymmetricFrame, choices: [{ ...choices[0], skuVariant }, choices[1]] });
  assert.equal(out[0].choices[0].summary.eligibleRCount, 0);
  assert.equal(out[0].choices[0].summary.eligibleLCount, 1);
  assert.equal(out[0].choices[0].status, 'belum-lolos');
  assert.equal(out[1].choices[0].candidates.length, 0);
  assert(out[1].choices[0].reasons.includes('sku-power-outside'));
});
test('invalid batch rows are reported, never coerced into zero prescriptions', () => {
  const out = batch.evaluate([{ sph: '', cyl: 0, add: 0 }, { sph: -9, cyl: 1, add: 0 }, { sph: -9, cyl: -4, add: 0 }], options);
  assert.equal(out[0].choices[0].status, 'input-tidak-valid');
  assert.equal(out[1].choices[0].status, 'input-tidak-valid');
  assert.equal(out[2].choices[0].status, 'lolos');
  assert.throws(() => batch.evaluate([], options), /1–20/);
  assert.throws(() => batch.evaluate(Array(21).fill({}), options), /1–20/);
  assert.throws(() => batch.evaluate([{}], { ...options, choices: [] }), /A dan B/);
});
